import { useEffect, useRef } from 'react'

export type VideoPlayerProps = {
  videoId: string
  hasCaptions: boolean
  posterUrl: string | null
  /** Reports playback position so transcript + chapters track the player. */
  onTimeUpdate: (ms: number) => void
  /** The parent registers the seek function; panels call it on cue/chapter click. */
  registerSeek: (seek: (ms: number) => void) => void
}

/**
 * A plain <video> element. Native controls, native caption track, native
 * range streaming — no player library. If one is ever needed, this component
 * is the only place that touches the element.
 */
export function VideoPlayer({ videoId, hasCaptions, posterUrl, onTimeUpdate, registerSeek }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    registerSeek((ms: number) => {
      const element = ref.current
      if (element === null) return
      element.currentTime = ms / 1000
      void element.play().catch(() => {})
    })
  }, [registerSeek])

  return (
    <video
      ref={ref}
      className="player"
      controls
      preload="metadata"
      poster={posterUrl ?? undefined}
      onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime * 1000)}
    >
      <source src={`/api/media/${videoId}`} type="video/mp4" />
      {hasCaptions && (
        <track
          kind="captions"
          src={`/api/captions/${videoId}`}
          srcLang="en"
          label="English"
          default
        />
      )}
    </video>
  )
}
