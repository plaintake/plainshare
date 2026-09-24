import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { errorJson } from '@/lib/api.server'
import { isVideoId } from '@/lib/ids'
import { captionsKey } from '@/lib/r2keys'
import { findServableVideo } from '@/lib/videos.server'

const IMMUTABLE = 'public, max-age=31536000, immutable'

/** Serves the stored VTT byte-identical — what was uploaded is what plays. */
export const Route = createFileRoute('/api/captions/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = await findServableVideo(params.id)
        if (row instanceof Response) return row
        if (!row.hasCaptions) return errorJson('not-found', 404)
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
