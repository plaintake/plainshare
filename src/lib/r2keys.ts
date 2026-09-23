import { isVideoId } from './ids'

/**
 * R2 keys are derived from the video id and gated by isVideoId on every join,
 * so no request-controlled string can ever reach a key.
 */
function requireVideoId(id: string): string {
  if (!isVideoId(id)) {
    throw new Error(`not a video id: ${id}`)
  }
  return id
}

export function sourceKey(id: string): string {
  return `videos/${requireVideoId(id)}/source.mp4`
}

export function captionsKey(id: string): string {
  return `videos/${requireVideoId(id)}/captions.vtt`
}

export function posterKey(id: string): string {
  return `videos/${requireVideoId(id)}/poster.jpg`
}
