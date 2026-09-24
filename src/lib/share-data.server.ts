import { count, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getRequestUrl } from '@tanstack/react-start/server'
import { db } from '@/db'
import { producers, viewEvents } from '@/db/schema'
import type { Chapter } from '@/lib/chapters'
import { isVideoId } from '@/lib/ids'
import { captionsKey } from '@/lib/r2keys'
import { findVideo } from '@/lib/videos.server'
import { videoState, type GoneShare } from '@/lib/visibility'
import { parseVtt, type VttCue } from '@/lib/vtt'

export type ShareData = {
  video: {
    id: string
    title: string | null
    filename: string
    durationMs: number | null
    hasCaptions: boolean
    hasPoster: boolean
    mediaUrl: string
    posterUrl: string
  }
  producer: { name: string; slug: string; homepageUrl: string | null } | null
  cues: VttCue[]
  chapters: Chapter[]
  initialViews: number
}

/**
 * Everything the share page renders, resolved server-side: metadata, producer,
 * view count, and the captions parsed into cues so the transcript is in the
 * SSR HTML (readable without JS, indexable) and the browser never parses VTT.
 *
 * The .server.ts suffix keeps this module — and its `cloudflare:workers`
 * imports — out of the client bundle entirely.
 */
export async function loadShareData(id: string): Promise<ShareData | GoneShare | null> {
  if (!isVideoId(id)) return null
  const row = await findVideo(id)
  if (row === null) return null
  const state = videoState(row, new Date())
  // The page renders a "no longer available" notice; src/server.ts turns
  // this shape into the response's 410.
  if (state !== 'live') return { gone: true, reason: state }

  let cues: VttCue[] = []
  if (row.hasCaptions) {
    const object = await env.BUCKET.get(captionsKey(row.id))
    if (object !== null) {
      try {
        cues = parseVtt(await object.text())
      } catch {
        // Captions were validated at write time; unreadable now means the
        // transcript panel is skipped, not the page.
        cues = []
      }
    }
  }

  const producer = (
    await db.select().from(producers).where(eq(producers.id, row.producerId)).limit(1)
  )[0]
  const views = (
    await db.select({ value: count() }).from(viewEvents).where(eq(viewEvents.videoId, row.id))
  )[0]!

  const origin = new URL(getRequestUrl()).origin
  return {
    video: {
      id: row.id,
      title: row.title,
      filename: row.filename,
      durationMs: row.durationMs,
      hasCaptions: row.hasCaptions,
      hasPoster: row.hasPoster,
      mediaUrl: `${origin}/api/media/${row.id}`,
      posterUrl: `${origin}/api/poster/${row.id}`,
    },
    producer: producer
      ? { name: producer.name, slug: producer.slug, homepageUrl: producer.homepageUrl }
      : null,
    cues,
    chapters: row.chapters === null ? [] : (JSON.parse(row.chapters) as Chapter[]),
    initialViews: views.value,
  }
}
