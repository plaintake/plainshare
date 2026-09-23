import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chapter } from '@/lib/chapters'
import type { VttCue } from '@/lib/vtt'
import { ChaptersPanel } from './chapters-panel'
import { TranscriptPanel } from './transcript-panel'
import { VideoPlayer } from './video-player'
import { ViewCounter } from './view-counter'

export type ShareViewerProps = {
  video: {
    id: string
    title: string | null
    filename: string
    durationMs: number | null
    hasCaptions: boolean
    hasPoster: boolean
    posterUrl: string
  }
  producer: { name: string; slug: string; homepageUrl: string | null } | null
  cues: VttCue[]
  chapters: Chapter[]
  initialViews: number
}

/**
 * Owns the single source of truth every panel shares: the current playback
 * position. Panels receive it as a prop and seek through one callback, so the
 * player, transcript highlight and chapter highlight can never disagree.
 */
export function ShareViewer({ video, producer, cues, chapters, initialViews }: ShareViewerProps) {
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const seekRef = useRef<(ms: number) => void>(() => {})

  // Marks the page as hydrated — inputs only become reactive once this lands,
  // so tests (and debugging) wait on it instead of racing client startup.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  const registerSeek = useCallback((seek: (ms: number) => void) => {
    seekRef.current = seek
  }, [])
  const seek = useCallback((ms: number) => {
    seekRef.current(ms)
  }, [])

  return (
    <main className="share-page">
      <div className="player-column">
        <VideoPlayer
          videoId={video.id}
          hasCaptions={video.hasCaptions}
          posterUrl={video.hasPoster ? video.posterUrl : null}
          onTimeUpdate={setCurrentTimeMs}
          registerSeek={registerSeek}
        />
        <div className="info-row">
          <h1 className="video-title">{video.title ?? video.filename}</h1>
          <div className="video-meta">
            <ViewCounter videoId={video.id} initialViews={initialViews} />
            {producer !== null && (
              <span className="producer">
                made with{' '}
                {producer.homepageUrl !== null ? (
                  <a href={producer.homepageUrl} rel="noopener noreferrer" target="_blank">
                    {producer.name}
                  </a>
                ) : (
                  producer.name
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      <aside className="side-panel">
        <ChaptersPanel chapters={chapters} currentTimeMs={currentTimeMs} onSeek={seek} />
        {cues.length > 0 ? (
          <TranscriptPanel cues={cues} currentTimeMs={currentTimeMs} onSeek={seek} />
        ) : (
          <section className="panel" aria-label="Transcript">
            <div className="panel-header">
              <h2>Transcript</h2>
            </div>
            <div className="panel-body">
              <p className="panel-empty">No captions.</p>
            </div>
          </section>
        )}
      </aside>
    </main>
  )
}
