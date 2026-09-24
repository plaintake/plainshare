import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { errorJson } from '@/lib/api.server'
import { mediaResponse } from '@/lib/media-response.server'
import { isVideoId } from '@/lib/ids'
import { sourceKey } from '@/lib/r2keys'
import { findServableVideo } from '@/lib/videos.server'

export const Route = createFileRoute('/api/media/$id')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = await findServableVideo(params.id)
        if (row instanceof Response) return row
        return mediaResponse(env.BUCKET, sourceKey(params.id), request, 'video/mp4')
      },
    },
  },
})
