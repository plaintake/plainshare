import { createFileRoute } from '@tanstack/react-router'
import { errorJson, json } from '@/lib/api.server'
import { isVideoId } from '@/lib/ids'
import { findVideo, requireOwnerOrAdmin, restoreVideo } from '@/lib/videos.server'
import { parseExpiresAt } from '@/lib/visibility'

/**
 * Undo an unpublish (or revive an expired video) before retention purges it.
 * Owner or admin; only the admin can undo an admin takedown. Optional JSON body
 * `{"expiresAt": "<ISO>" | "none"}` sets the expiry going forward. Restoring a
 * live video is a no-op; a purged one is simply gone (404).
 */
export const Route = createFileRoute('/api/videos/$id/restore')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = await findVideo(params.id)
        if (row === null) return errorJson('not-found', 404)
        const actor = await requireOwnerOrAdmin(request, row)
        if (actor instanceof Response) return actor

        let expires: Date | 'clear' | undefined
        const raw = await request.text()
        if (raw.trim() !== '') {
          let body: unknown
          try {
            body = JSON.parse(raw)
          } catch {
            return errorJson('invalid-json', 400)
          }
          if (body !== null && typeof body === 'object' && 'expiresAt' in body) {
            const value = (body as { expiresAt: unknown }).expiresAt
            if (typeof value !== 'string') return errorJson('invalid-expires-at', 400)
            try {
              expires = parseExpiresAt(value, new Date())
            } catch {
              return errorJson('invalid-expires-at', 400)
            }
          }
        }

        const restored = await restoreVideo(row, actor, expires)
        if (restored instanceof Response) return restored
        const origin = new URL(request.url).origin
        return json({
          id: restored.id,
          url: `${origin}/${restored.id}`,
          expiresAt: restored.expiresAt?.toISOString() ?? null,
        })
      },
    },
  },
})
