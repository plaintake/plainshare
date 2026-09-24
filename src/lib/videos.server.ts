import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { videos, type Video } from '@/db/schema'
import { errorJson } from '@/lib/api.server'
import { requireAdmin, requireProducer } from '@/lib/auth.server'
import { sourceKey } from '@/lib/r2keys'
import { videoState } from '@/lib/visibility'

export const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_GRACE_DAYS = 30

export async function findVideo(id: string): Promise<Video | null> {
  const rows = await db.select().from(videos).where(eq(videos.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * The read-path lookup: the row when it may be served, else the 404 (no row) or
 * 410 (`unpublished` / `expired`) response. Every public route goes through
 * this, so visibility is decided in exactly one place (src/lib/visibility.ts).
 */
export async function findServableVideo(id: string, now = new Date()): Promise<Video | Response> {
  const row = await findVideo(id)
  if (row === null) return errorJson('not-found', 404)
  const state = videoState(row, now)
  return state === 'live' ? row : errorJson(state, 410)
}

/** Days an unpublished video lingers (restorable) before the purge. */
export function graceDays(): number {
  const parsed = Number.parseInt(env.PURGE_GRACE_DAYS ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_DAYS
}

export function purgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + graceDays() * DAY_MS)
}

export type Actor = { kind: 'admin' } | { kind: 'producer'; producerId: string }

/**
 * Owner-or-admin gate shared by unpublish and restore. An X-Admin-Token header
 * selects the admin path outright (a wrong token is a 401, never a fallback to
 * the bearer key); otherwise the bearer key must own the row.
 */
export async function requireOwnerOrAdmin(
  request: Request,
  row: Video,
): Promise<Actor | Response> {
  if (request.headers.has('x-admin-token')) {
    const gate = await requireAdmin(request)
    return gate ?? { kind: 'admin' }
  }
  const producer = await requireProducer(request)
  if (producer === null) return errorJson('unauthorized', 401)
  if (producer.id !== row.producerId) return errorJson('forbidden', 403)
  return { kind: 'producer', producerId: producer.id }
}

/**
 * Brings a tombstoned (or expired) video back, or just re-dates a live one's
 * expiry. `expires` is the parsed request value: a Date sets it, 'clear'
 * removes it, undefined keeps the current one unless it already passed — a
 * restore that immediately re-expires would be no restore at all.
 *
 * Only the admin may undo an admin takedown. The R2 head check covers the one
 * window where the row outlives its media: a purge whose object delete landed
 * but whose row delete did not yet — the next retention run finishes it.
 */
export async function restoreVideo(
  row: Video,
  actor: Actor,
  expires: Date | 'clear' | undefined,
  now = new Date(),
): Promise<Video | Response> {
  if (row.deletedBy === 'admin' && actor.kind !== 'admin') return errorJson('taken-down', 403)
  if (row.deletedAt !== null && (await env.BUCKET.head(sourceKey(row.id))) === null) {
    return errorJson('purged', 410)
  }
  const expiresAt =
    expires === 'clear'
      ? null
      : (expires ?? (row.expiresAt !== null && row.expiresAt > now ? row.expiresAt : null))
  const updated = await db
    .update(videos)
    .set({ deletedAt: null, deletedBy: null, expiresAt, updatedAt: now })
    .where(eq(videos.id, row.id))
    .returning()
  return updated[0]!
}
