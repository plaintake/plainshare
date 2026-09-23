import { z } from 'zod'

/**
 * Chapters arrive as JSON from the producer and land in the videos.chapters
 * column. Marks may omit endMs — the next mark's startMs (or the video
 * duration) fills it — but unsorted or overlapping marks are rejected: a
 * chapter list that doesn't tile is a producer bug worth naming, not rendering.
 */
const ChapterMarkSchema = z.object({
  title: z.string().min(1).max(200),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive().optional(),
})

export type Chapter = z.infer<typeof ChapterMarkSchema> & { endMs: number }

export const MAX_CHAPTERS = 200

export function parseChapters(input: unknown, durationMs?: number): Chapter[] {
  const sorted = [...z.array(ChapterMarkSchema).max(MAX_CHAPTERS).parse(input)].sort(
    (a, b) => a.startMs - b.startMs,
  )

  const chapters: Chapter[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const mark = sorted[i]!
    const nextStart = sorted[i + 1]?.startMs
    const endMs = mark.endMs ?? nextStart ?? durationMs ?? Number.MAX_SAFE_INTEGER
    if (endMs <= mark.startMs) {
      throw new Error(`chapter "${mark.title}" ends at ${endMs}ms, at or before its start ${mark.startMs}ms`)
    }
    const previous = chapters[i - 1]
    if (previous !== undefined && mark.startMs < previous.endMs) {
      throw new Error(`chapter "${mark.title}" starts at ${mark.startMs}ms, inside "${previous.title}" (ends ${previous.endMs}ms)`)
    }
    chapters.push({ title: mark.title, startMs: mark.startMs, endMs })
  }
  return chapters
}
