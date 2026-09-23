import { createFileRoute } from '@tanstack/react-router'
import { count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { videos, viewEvents } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { sha256Hex } from '@/lib/auth.server'
import { isVideoId } from '@/lib/ids'

/**
 * Records a view as an idempotent event: one row per (video, viewer, UTC day).
 * The client dedupes via a persisted viewerId; INSERT OR IGNORE dedupes the
 * rest. The count is derived, never incremented.
 */
export const Route = createFileRoute('/api/view/$id')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = (await db.select({ id: videos.id }).from(videos).where(eq(videos.id, params.id)).limit(1))[0]
        if (row === undefined) return errorJson('not-found', 404)

        let viewerId: string | undefined
        try {
          const body: unknown = await request.json()
          if (body !== null && typeof body === 'object' && 'viewerId' in body) {
            const raw = (body as { viewerId?: unknown }).viewerId
            if (typeof raw === 'string' && raw !== '') viewerId = raw.slice(0, 100)
          }
        } catch {
          // Empty or non-JSON body: fall through to ip+ua identity.
        }
        const identity =
          viewerId ??
          `${request.headers.get('cf-connecting-ip') ?? 'unknown'}|${request.headers.get('user-agent') ?? 'unknown'}`

        const viewerHash = await sha256Hex(identity)
        const day = new Date().toISOString().slice(0, 10)
        await db
          .insert(viewEvents)
          .values({ videoId: params.id, viewerHash, day })
          .onConflictDoNothing()

        const views = (
          await db.select({ value: count() }).from(viewEvents).where(eq(viewEvents.videoId, params.id))
        )[0]!
        return json({ views: views.value })
      },
    },
  },
})
