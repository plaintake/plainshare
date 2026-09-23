import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { videos } from '@/db/schema'
import { errorJson } from '@/lib/api.server'
import { isVideoId } from '@/lib/ids'
import { captionsKey } from '@/lib/r2keys'

const IMMUTABLE = 'public, max-age=31536000, immutable'

/** Serves the stored VTT byte-identical — what was uploaded is what plays. */
export const Route = createFileRoute('/api/captions/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = (await db.select().from(videos).where(eq(videos.id, params.id)).limit(1))[0]
        if (row === undefined || !row.hasCaptions) return errorJson('not-found', 404)
        const object = await env.BUCKET.get(captionsKey(params.id))
        if (object === null) return errorJson('not-found', 404)
        return new Response(object.body, {
          status: 200,
          headers: {
            'content-type': 'text/vtt; charset=utf-8',
            'content-length': String(object.size),
            'cache-control': IMMUTABLE,
          },
        })
      },
    },
  },
})
