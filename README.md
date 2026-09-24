# PlainShare

Share captioned, chaptered MP4 videos with a link. Any producer with an MP4,
optional WebVTT captions and chapter marks can upload; viewers get a page with
a native player, a clickable transcript, clickable chapters and a view count.

PlainShare is **generic**: nothing in the API knows about any particular
producer. [PlainTake](https://github.com/plaintake/plaintake) is the first
client (`plaintake publish`); any tool that produces captioned/chaptered MP4s
can reuse it unchanged.

Built with TanStack Start on Cloudflare Workers (R2 for media, D1 for
metadata).

## Example

https://plainshare.plainstudio.workers.dev/fknjswt5ac4v65juzuvcwkkqoi

## How it works

A share's ID is **derived from the video's content**: the first 16 bytes of
`sha256(mp4)`, base32-encoded (RFC 4648, lowercase, no padding) — exactly 26
characters, `^[a-z2-7]{26}$`.

```text
sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
id:     4oymiquy7qobjgx36tejs35zeq
```

Because the ID is the content's fingerprint:

- the client sends `X-Content-Sha256` with the upload; the server checks the
  ID matches the digest, and R2 verifies the digest against the bytes **while
  writing** — a failed write leaves no object and no row, ever;
- media is immutable and served with `Cache-Control: public,
  max-age=31536000, immutable`;
- re-uploading identical bytes is a no-op (`deduped: true`), not an error.

## API

All API routes live under `/api`. Producers authenticate with a bearer key:
`Authorization: Bearer sk_…`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/ping` | health check |
| `GET` | `/api/version` | service version |
| `POST` | `/api/producers` | create producer + key (admin-gated) |
| `POST` | `/api/producers/:slug/reissue` | re-issue a producer's key, same row (admin-gated) |
| `GET` | `/api/producers/me` | who a bearer key resolves to — verify without uploading |
| `HEAD` | `/api/videos/:id` | live? 200 / 404 / 410 — dedup probe |
| `GET` | `/api/videos/:id` | metadata (title, dimensions, views, producer, expiry, …) |
| `PUT` | `/api/videos/:id` | upload the MP4 (re-PUT by the owner restores an unpublished one) |
| `DELETE` | `/api/videos/:id` | unpublish (owner or admin) — purged after the grace period |
| `POST` | `/api/videos/:id/restore` | undo an unpublish / expiry before the purge |
| `POST` | `/api/videos/:id/sidecars` | attach captions / chapters / poster / title / expiry |
| `GET` | `/api/media/:id` | the MP4 (single `Range` supported) |
| `GET` | `/api/captions/:id` | the WebVTT, byte-identical to what was uploaded |
| `GET` | `/api/poster/:id` | the poster JPEG |
| `POST` | `/api/view/:id` | record a view (idempotent per viewer/day) |
| `GET` | `/:id` | the share page (SSR transcript, player, chapters) |
| `POST` | `/api/admin/retention` | run the retention pass now (admin-gated) |

### Create a producer (admin)

```sh
curl -X POST http://localhost:8787/api/producers \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"PlainTake","slug":"plaintake","homepageUrl":"https://plaintake.github.io"}'
```

`201 {"id":…,"slug":"plaintake","key":"sk_…"}` — the key is shown **exactly
once**; only its hash is stored. `slug` must match `^[a-z0-9][a-z0-9-]{0,39}$`.

### Rotate a producer key (admin)

A lost or leaked key is re-issued **on the same row** — same id, slug and
ownership of every video it uploaded; no duplicate producers:

```sh
curl -X POST http://localhost:8787/api/producers/plainshare/reissue \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

`200 {"id":…,"slug":…,"name":…,"key":"sk_…"}` — the new key is shown **exactly
once**. The old key stops working immediately: only its hash was stored, and the
hash is gone. `rotated_at` records when. Prove a key (new or stored) without
uploading anything:

```sh
curl http://localhost:8787/api/producers/me \
  -H "Authorization: Bearer $KEY"
```

`200 {"id":…,"slug":…,"name":…}` when the key resolves, `401` when it does not.

### Upload a video

```sh
SHA=$(shasum -a 256 demo.mp4 | cut -d' ' -f1)
ID=$(python3 - "$SHA" <<'EOF'
import sys
digest = bytes.fromhex(sys.argv[1])[:16]
alpha = 'abcdefghijklmnopqrstuvwxyz234567'
bits = value = 0
out = ''
for byte in digest:
    value = (value << 8) | byte
    bits += 8
    while bits >= 5:
        out += alpha[(value >> (bits - 5)) & 31]
        bits -= 5
print(out)
EOF
)

curl -X PUT "http://localhost:8787/api/videos/$ID" \
  -H "Authorization: Bearer $KEY" \
  -H "X-Content-Sha256: $SHA" \
  -H "X-Filename: demo.mp4" \
  -H "X-Title: Create an API key" \
  -H "X-Width: 1920" -H "X-Height: 1080" -H "X-Duration-Ms: 42000" \
  -H 'content-type: video/mp4' \
  --data-binary @demo.mp4
```

`201 {"id":…,"url":"http://localhost:8787/<id>","deduped":false}`.
Same bytes again → `200 {"deduped":true}`. Same ID owned by another producer
→ `409`. Digest not matching the ID, or bytes not matching the digest → `400`
with **nothing stored**.

### Attach sidecars

```sh
curl -X POST "http://localhost:8787/api/videos/$ID/sidecars" \
  -H "Authorization: Bearer $KEY" \
  -F 'captions=@captions.vtt;type=text/vtt' \
  -F 'chapters=@chapters.json;type=application/json' \
  -F 'poster=@poster.jpg;type=image/jpeg'
```

- `captions` — WebVTT; validated server-side (≥1 cue, sane timestamps), then
  stored and served byte-identical.
- `chapters` — JSON array `[{"title":"Intro","startMs":0},…]` (≤200 marks,
  no overlaps; missing `endMs` is filled from the next mark).
- `poster` — JPEG (magic bytes checked).
- `title` — form field, ≤200 chars.
- `expiresAt` — form field: an ISO-8601 instant in the future, or `none` to
  clear the expiry.

All parts optional, at least one required. Only the owning producer may call
this (`403` otherwise).

### Unpublish, restore, expiry

Unpublishing is a **tombstone**, not a delete. The share page, metadata,
media, captions, poster and view endpoints answer `410 Gone` right away
(`{"error":"unpublished"}`; the page renders "Video unavailable" with a 410
and `noindex`). The bytes stay put, and the video can be restored, until
retention purges it after the grace period (below).

```sh
curl -X DELETE "http://localhost:8787/api/videos/$ID" \
  -H "Authorization: Bearer $KEY"
```

`200 {"id":…,"deletedAt":…,"deletedBy":"producer","purgeAfter":…}`. Repeating it
is a no-op. Another producer's key gets `403`. The admin can take down any
video with `-H "X-Admin-Token: $ADMIN_TOKEN"` instead (`deletedBy: "admin"`).

Undo it before `purgeAfter`, either explicitly or by publishing the same bytes
again (the `PUT` answers `{"deduped":true,"restored":true}`):

```sh
curl -X POST "http://localhost:8787/api/videos/$ID/restore" \
  -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"expiresAt":"none"}'   # body optional
```

Only the admin can undo an **admin takedown**. The owner's restore and re-`PUT`
both get `403 {"error":"taken-down"}`.

**Expiry.** A producer can give a video a TTL with `X-Expires-At: <ISO-8601>`
on the `PUT`, or an `expiresAt` sidecar field (`none` clears it). Once the
instant passes, every read path answers `410 {"error":"expired"}` straight
away; it doesn't wait for the sweep. After that it follows the same grace-then-purge
path as an unpublish, and it can be restored the same way (a past expiry is
cleared on restore).

### Retention

A daily cron (`triggers.crons` in `wrangler.jsonc`, 03:17 UTC) runs
`src/lib/retention.server.ts`:

1. **Expire.** Videos past `expiresAt` become tombstones dated at their
   expiry, so the grace period counts from when they went dark.
2. **Purge.** Tombstones older than `PURGE_GRACE_DAYS` (a `wrangler.jsonc`
   var, default `30`) lose their R2 objects, their `view_events` and their row,
   up to 100 per run. R2 is deleted first, so a failed run is retried the next
   day and never leaves objects without a row.

After a purge the id is free again. The same bytes upload fresh (`201`), by
anyone.

Run the pass now (after an abuse takedown, say). `graceDays` overrides the
configured grace for this run only, and `0` purges every tombstone:

```sh
curl -X POST http://localhost:8787/api/admin/retention \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"graceDays":0}'
```

`200 {"expired":…,"purged":…,"graceDays":…}`. Locally, the cron itself fires
with `curl -X POST http://localhost:8787/cdn-cgi/handler/scheduled`.

**Caching caveat.** Media, captions and posters are served `immutable` for a
year: an id's bytes can never change, so that is safe. It also means a
browser that already fetched a video may keep its copy after an unpublish.
The 410 stops new fetches; it can't recall old ones.

## No CORS — by design

v1 serves **no CORS headers**. The share page is same-origin, and producers
are expected to talk to the API server-to-server (or from a CLI). Browser-side
third-party uploads would put producer keys in pages; if you need that, proxy
through your own backend. This is deliberate — don't "fix" it by accident.

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars          # set ADMIN_TOKEN
pnpm db:migrate:local                   # apply D1 migrations
pnpm dev                                # http://localhost:8787
```

Local dev runs on miniflare — no Cloudflare account needed, and the committed
`wrangler.jsonc` works as-is: locally its `database_id` is just a state key.
You swap in your own only to deploy (below).

Local state (D1 + R2) lives under `.wrangler/state`; delete it and re-run
migrations for a clean slate.

```sh
pnpm test          # unit tests (ids / vtt / chapters / visibility)
pnpm test:e2e      # Playwright against the dev server (needs ffmpeg)
pnpm typecheck
pnpm build
```

The e2e suite starts its own dev server if none is running and uploads real
ffmpeg-generated clips, so it exercises actual seeking, not stubs.

## Deploying

`wrangler.jsonc` in this repo is wired to the PlainLab deployment — a D1
`database_id` belongs to the account that created the database. Run your own
from the template:

```sh
cp wrangler.jsonc.example wrangler.jsonc  # then paste in your database_id
wrangler r2 bucket create share-media
wrangler d1 create share-db              # prints the id → wrangler.jsonc
wrangler secret put ADMIN_TOKEN
pnpm db:migrate:remote
pnpm deploy
```

Then create a production producer exactly as above (with the production
`ADMIN_TOKEN`) and hand the key to your publisher. A lost production key is
rotated in place — see "Rotate a producer key" — instead of re-registering.
When `migrations/` gains files, run `pnpm db:migrate:remote` **before**
`pnpm deploy`.

## Repository layout

```text
src/routes/api/       API endpoints (server handlers)
src/routes/$id.tsx    the share page (SSR loader → ShareViewer, or the 410 notice)
src/server.ts         worker entry: Start's fetch (+ 410 for gone shares) and the retention cron
src/components/       player, transcript, chapters, view counter
src/lib/              ids, vtt parsing, chapter validation, auth, R2 keys,
                      visibility (live / unpublished / expired), retention
src/db/               drizzle schema (producers, videos, viewEvents)
migrations/           generated D1 migrations (wrangler applies them)
test/e2e/             Playwright suite (real ffmpeg clips)
```

## Security notes

- Producer keys: `sk_<24 hex>`; stored only as sha256; looked up by hash.
  Rotation overwrites the hash, so the old key dies instantly; `rotated_at`
  records when it happened.
- IDs are validated (`^[a-z2-7]{26}$`) before any storage key is built — no
  path injection through `:id`.
- Uploads capped at 2 GiB; sidecar parts at 2 MB each / 5 MB total.
- View counting hashes the viewer's id (or IP+UA) — no raw addresses stored,
  and the PK `(videoId, viewerHash, day)` makes double-counting impossible.

## License

MIT
