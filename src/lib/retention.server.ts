import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { videos, viewEvents } from '@/db/schema'
import { DAY_MS, graceDays as configuredGraceDays } from '@/lib/videos.server'
import { captionsKey, posterKey, sourceKey } from '@/lib/r2keys'

/** Per-run cap keeps one invocation well inside the Worker's limits; the rest waits a day. */
const PURGE_BATCH = 100

export type RetentionResult = { expired: number; purged: number; graceDays: number }

/**
 * The retention pass the cron runs daily (and POST /api/admin/retention runs on
 * demand):
 *
 * 1. Expire — past-TTL rows become tombstones dated at their expiresAt, so the
 *    grace period counts from when the video actually went dark. (Reads already
 *    410 them via videoState; this only makes them purgeable.)
 * 2. Purge — tombstones older than the grace lose their R2 objects first, then
 *    their view_events and row in one batch. R2 goes first so a failed delete
 *    leaves the row for the next run to retry, never objects without a row.
 */
export async function runRetention(
  now: Date,
  graceDays = configuredGraceDays(),
): Promise<RetentionResult> {
  const expired = await db
    .update(videos)
    .set({ deletedAt: videos.expiresAt, deletedBy: 'expired', updatedAt: now })
    .where(and(isNull(videos.deletedAt), isNotNull(videos.expiresAt), lte(videos.expiresAt, now)))
    .returning({ id: videos.id })

  const cutoff = new Date(now.getTime() - graceDays * DAY_MS)
  const due = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(isNotNull(videos.deletedAt), lte(videos.deletedAt, cutoff)))
    .limit(PURGE_BATCH)

  let purged = 0
  for (const { id } of due) {
    try {
      await env.BUCKET.delete([sourceKey(id), captionsKey(id), posterKey(id)])
      // view_events first: D1 enforces the foreign key onto videos.
      await db.batch([
        db.delete(viewEvents).where(eq(viewEvents.videoId, id)),
        db.delete(videos).where(eq(videos.id, id)),
      ])
      purged += 1
    } catch (error) {
      console.error(JSON.stringify({ event: 'retention-purge-failed', id, error: String(error) }))
    }
  }

  return { expired: expired.length, purged, graceDays }
}
