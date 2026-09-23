import { createFileRoute } from '@tanstack/react-router'
import { count, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { producers, videos, viewEvents } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { requireProducer } from '@/lib/auth.server'
import { isVideoId, videoIdFromSha256Hex } from '@/lib/ids'
import { sourceKey } from '@/lib/r2keys'

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB

function headerString(request: Request, name: string): string | null {
  const raw = request.headers.get(name)
  if (raw === null) return null
  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  const trimmed = decoded.trim()
  return trimmed === '' ? null : trimmed
}

function headerInt(request: Request, name: string): number | null {
  const raw = headerString(request, name)
  if (raw === null) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'video.mp4'
  return base.slice(0, 200) || 'video.mp4'
}

async function findVideo(id: string) {
  const rows = await db.select().from(videos).where(eq(videos.id, id)).limit(1)
  return rows[0] ?? null
}

export const Route = createFileRoute('/api/videos/$id')({
  server: {
    handlers: {
      /** Client dedup probe: row exists means verified bytes are already shared. */
      HEAD: async ({ params }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = await findVideo(params.id)
        if (row === null) return errorJson('not-found', 404)
        return new Response(null, { status: 200, headers: { 'x-status': 'ready' } })
      },

      GET: async ({ params, request }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = await findVideo(params.id)
        if (row === null) return errorJson('not-found', 404)
        const producer = (
          await db.select().from(producers).where(eq(producers.id, row.producerId)).limit(1)
        )[0]
        const views = (
          await db
            .select({ value: count() })
            .from(viewEvents)
            .where(eq(viewEvents.videoId, row.id))
        )[0]!
        const origin = new URL(request.url).origin
        return json({
          id: row.id,
          url: `${origin}/${row.id}`,
          title: row.title,
          filename: row.filename,
          width: row.width,
          height: row.height,
          durationMs: row.durationMs,
          bytes: row.bytes,
          sha256: row.sha256,
          hasCaptions: row.hasCaptions,
          hasChapters: row.chapters !== null,
          hasPoster: row.hasPoster,
          views: views.value,
          createdAt: row.createdAt.toISOString(),
          producer: producer
            ? { name: producer.name, slug: producer.slug, homepageUrl: producer.homepageUrl }
            : null,
        })
      },

      /**
       * Streaming upload of the raw MP4. The id must equal the first 16 sha256
       * bytes of the body: pre-flight the header digest against the id, then
       * hand the digest to R2's put() checksum option, which verifies it over
       * the received bytes and fails the write atomically — a mismatch leaves
       * no object behind. FixedLengthStream turns a lying Content-Length into
       * a clean failure instead of a truncated object.
       */
      PUT: async ({ params, request }) => {
        const id = params.id
        if (!isVideoId(id)) return errorJson('invalid-id', 400)

        const producer = await requireProducer(request)
        if (producer === null) return errorJson('unauthorized', 401)

        const contentLengthHeader = request.headers.get('content-length')
        if (contentLengthHeader === null) return errorJson('length-required', 411)
        const contentLength = Number.parseInt(contentLengthHeader, 10)
        if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
          return errorJson('invalid-length', 400)
        }
        if (contentLength > MAX_UPLOAD_BYTES) return errorJson('too-large', 413)

        const digest = (request.headers.get('x-content-sha256') ?? '').trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(digest)) return errorJson('sha256-required', 400)
        if (videoIdFromSha256Hex(digest) !== id) return errorJson('hash-mismatch', 400)

        const existing = await findVideo(id)
        if (existing !== null) {
          if (existing.producerId === producer.id) {
            const origin = new URL(request.url).origin
            return json({ id, url: `${origin}/${id}`, deduped: true })
          }
          return errorJson('owned-by-another-producer', 409)
        }

        if (request.body === null) return errorJson('empty-body', 400)
        const fixed = new FixedLengthStream(contentLength)
        const pipe = request.body.pipeTo(fixed.writable)
        // The pipe's failure surfaces through put() rejecting; keeping the
        // rejection from becoming unhandled is all this catch is for.
        pipe.catch(() => {})

        try {
          await env.BUCKET.put(sourceKey(id), fixed.readable, {
            sha256: digest,
            httpMetadata: { contentType: 'video/mp4' },
          })
        } catch {
          return errorJson('hash-mismatch', 400)
        }

        const title = headerString(request, 'x-title')
        const row = {
          id,
          producerId: producer.id,
          filename: sanitizeFilename(headerString(request, 'x-filename') ?? 'video.mp4'),
          title: title === null ? null : title.slice(0, 200),
          width: headerInt(request, 'x-width'),
          height: headerInt(request, 'x-height'),
          durationMs: headerInt(request, 'x-duration-ms'),
          bytes: contentLength,
          sha256: digest,
        }
        try {
          await db.insert(videos).values(row)
        } catch {
          // A concurrent identical upload inserted first: same bytes, same
          // checksum, so fall through to the ownership answer.
          const raced = await findVideo(id)
          if (raced === null) return errorJson('insert-failed', 500)
          if (raced.producerId !== producer.id) return errorJson('owned-by-another-producer', 409)
          const origin = new URL(request.url).origin
          return json({ id, url: `${origin}/${id}`, deduped: true })
        }

        const origin = new URL(request.url).origin
        return json({ id, url: `${origin}/${id}`, deduped: false }, 201)
      },
    },
  },
})
