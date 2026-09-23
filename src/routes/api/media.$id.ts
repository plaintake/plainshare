import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { videos } from '@/db/schema'
import { errorJson } from '@/lib/api.server'
import { mediaResponse } from '@/lib/media-response.server'
import { isVideoId } from '@/lib/ids'
import { sourceKey } from '@/lib/r2keys'

export const Route = createFileRoute('/api/media/$id')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!isVideoId(params.id)) return errorJson('invalid-id', 400)
        const row = (await db.select().from(videos).where(eq(videos.id, params.id)).limit(1))[0]
        if (row === undefined) return errorJson('not-found', 404)
        return mediaResponse(env.BUCKET, sourceKey(params.id), request, 'video/mp4')
      },
    },
  },
})
