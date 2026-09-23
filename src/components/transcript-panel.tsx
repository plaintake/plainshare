import { useEffect, useMemo, useRef, useState } from 'react'
import type { VttCue } from '@/lib/vtt'

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function activeCueIndex(cues: VttCue[], currentTimeMs: number): number {
  let active = -1
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i]!.startMs <= currentTimeMs) active = i
    else break
  }
  return active
}

export type TranscriptPanelProps = {
  cues: VttCue[]
  currentTimeMs: number
  onSeek: (ms: number) => void
}

/**
 * Clickable transcript. The active cue follows playback; auto-scroll yields to
 * the user for a few seconds after they scroll the list themselves, so reading
 * ahead is never fought by the page.
 */
export function TranscriptPanel({ cues, currentTimeMs, onSeek }: TranscriptPanelProps) {
  const [query, setQuery] = useState('')
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const suppressScrollUntil = useRef(0)

  const visibleCues = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return cues.map((cue, index) => ({ cue, index }))
    return cues
      .map((cue, index) => ({ cue, index }))
      .filter(({ cue }) => cue.text.toLowerCase().includes(needle))
  }, [cues, query])

  const activeIndex = activeCueIndex(cues, currentTimeMs)

  useEffect(() => {
    if (query.trim() !== '') return
    if (Date.now() < suppressScrollUntil.current) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, query])

  return (
    <section className="panel transcript-panel" aria-label="Transcript">
      <div className="panel-header">
        <h2>Transcript</h2>
        <input
          type="search"
          className="transcript-search"
          placeholder="Search captions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search transcript"
        />
      </div>
      <div
        className="panel-body"
        onScroll={() => {
          suppressScrollUntil.current = Date.now() + 3000
        }}
      >
        {visibleCues.length === 0 ? (
          <p className="panel-empty">{query.trim() === '' ? 'No captions.' : 'No matches.'}</p>
        ) : (
          visibleCues.map(({ cue, index }) => (
            <button
              key={index}
              ref={index === activeIndex ? activeRef : undefined}
              className={`cue${index === activeIndex ? ' active' : ''}`}
              onClick={() => onSeek(cue.startMs + 1)}
            >
              <span className="cue-time">{formatTimestamp(cue.startMs)}</span>
              <span className="cue-text">{cue.text}</span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
