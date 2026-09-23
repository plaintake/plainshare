import type { Chapter } from '@/lib/chapters'
import { formatTimestamp } from './transcript-panel'

export type ChaptersPanelProps = {
  chapters: Chapter[]
  currentTimeMs: number
  onSeek: (ms: number) => void
}

function activeChapterIndex(chapters: Chapter[], currentTimeMs: number): number {
  let active = -1
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i]!.startMs <= currentTimeMs) active = i
    else break
  }
  return active
}

/**
 * Chapter navigation — the piece screendrop's viewer doesn't have: click a
 * chapter, the player jumps there; the highlight follows playback across
 * chapter boundaries.
 */
export function ChaptersPanel({ chapters, currentTimeMs, onSeek }: ChaptersPanelProps) {
  if (chapters.length === 0) return null
  const activeIndex = activeChapterIndex(chapters, currentTimeMs)

  return (
    <section className="panel chapters-panel" aria-label="Chapters">
      <div className="panel-header">
        <h2>Chapters</h2>
      </div>
      <div className="panel-body">
        {chapters.map((chapter, index) => (
          <button
            key={`${chapter.startMs}-${chapter.title}`}
            className={`chapter${index === activeIndex ? ' active' : ''}`}
            onClick={() => onSeek(chapter.startMs + 1)}
          >
            <span className="chapter-time">{formatTimestamp(chapter.startMs)}</span>
            <span className="chapter-title">{chapter.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
