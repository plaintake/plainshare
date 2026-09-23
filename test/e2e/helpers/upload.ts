import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** Same derivation as src/lib/ids.ts (and plaintake's publish client). */
export function base32Lower(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function videoIdFor(sha256Hex: string): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) bytes[i] = Number.parseInt(sha256Hex.slice(i * 2, i * 2 + 2), 16)
  return base32Lower(bytes)
}

async function sha256File(path: string): Promise<string> {
  const { stdout } = await exec('shasum', ['-a', '256', path])
  return stdout.split(' ')[0]!.trim()
}

/**
 * Renders a small test clip with ffmpeg — real H.264 bytes so the browser can
 * actually seek in it. Each call embeds a unique metadata tag, so two calls
 * never produce the same content id (content addressing would otherwise 409 a
 * re-run's upload under this run's fresh producer).
 */
export async function makeTestVideo(tag = ''): Promise<
  { path: string; sha256: string; id: string; durationMs: number }
> {
  const dir = join(tmpdir(), `plainshare-e2e-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'demo.mp4')
  await exec('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=duration=6:size=640x360:rate=30',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-profile:v', 'baseline',
    '-metadata', `comment=plainshare-e2e-${tag}-${randomUUID()}`,
    path,
  ])
  const sha256 = await sha256File(path)
  return { path, sha256, id: videoIdFor(sha256), durationMs: 6000 }
}

export const TEST_CAPTIONS = `WEBVTT

00:00:00.000 --> 00:00:02.000
Red frames ahead.

00:00:02.000 --> 00:00:04.000
Green takes over.

00:00:04.000 --> 00:00:06.000
Blue to finish.
`

export const TEST_CHAPTERS = [
  { title: 'Red', startMs: 0 },
  { title: 'Green', startMs: 2000 },
  { title: 'Blue', startMs: 4000 },
]

export async function adminToken(): Promise<string> {
  const raw = await readFile(join(process.cwd(), '.dev.vars'), 'utf8')
  const match = /^ADMIN_TOKEN=(.+)$/m.exec(raw)
  if (match === null) throw new Error('no ADMIN_TOKEN in .dev.vars')
  return match[1]!.trim()
}

export type Producer = { key: string; slug: string }

export async function createProducer(base: string, slug: string): Promise<Producer> {
  const response = await fetch(`${base}/api/producers`, {
    method: 'POST',
    headers: { 'x-admin-token': await adminToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ name: `E2E ${slug}`, slug, homepageUrl: 'https://example.com' }),
  })
  if (response.status === 409) {
    // Slug taken by a previous run; make this run's producer unique.
    return createProducer(base, `${slug}-${Date.now()}`)
  }
  if (!response.ok) throw new Error(`producer create failed: ${response.status}`)
  // The parsed slug, not the asked-for one: a 409 retry above may have renamed it.
  return (await response.json()) as Producer
}

/** Admin key rotation: same row, fresh key. A 404 here is a bug, not contention. */
export async function rotateProducerKey(base: string, slug: string): Promise<Producer> {
  const response = await fetch(`${base}/api/producers/${slug}/reissue`, {
    method: 'POST',
    headers: { 'x-admin-token': await adminToken() },
  })
  if (!response.ok) throw new Error(`key reissue failed: ${response.status}`)
  return (await response.json()) as Producer
}

/** Full protocol: PUT video, then sidecars. Returns the share id. */
export async function uploadVideo(
  base: string,
  key: string,
  video: { path: string; sha256: string; id: string; durationMs: number },
  parts: { captions?: boolean; chapters?: boolean; poster?: boolean } = { captions: true, chapters: true },
): Promise<string> {
  const bytes = await readFile(video.path)
  const put = await fetch(`${base}/api/videos/${video.id}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${key}`,
      'x-content-sha256': video.sha256,
      'x-filename': 'demo.mp4',
      'x-title': 'E2E test video',
      'x-width': '640',
      'x-height': '360',
      'x-duration-ms': String(video.durationMs),
      'content-type': 'video/mp4',
    },
    body: new Uint8Array(bytes),
  })
  if (!(put.status === 201 || put.status === 200)) {
    throw new Error(`video put failed: ${put.status} ${await put.text()}`)
  }

  if (parts.captions || parts.chapters) {
    const form = new FormData()
    if (parts.captions) {
      form.append('captions', new Blob([TEST_CAPTIONS], { type: 'text/vtt' }), 'captions.vtt')
    }
    if (parts.chapters) {
      form.append('chapters', new Blob([JSON.stringify(TEST_CHAPTERS)], { type: 'application/json' }), 'chapters.json')
    }
    const sidecars = await fetch(`${base}/api/videos/${video.id}/sidecars`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    })
    if (!sidecars.ok) throw new Error(`sidecars failed: ${sidecars.status} ${await sidecars.text()}`)
  }

  if (parts.poster) {
    const posterPath = `${video.path}.jpg`
    await exec('ffmpeg', ['-y', '-i', video.path, '-frames:v', '1', '-q:v', '3', posterPath])
    const poster = await readFile(posterPath)
    const form = new FormData()
    form.append('poster', new Blob([new Uint8Array(poster)], { type: 'image/jpeg' }), 'poster.jpg')
    const sidecars = await fetch(`${base}/api/videos/${video.id}/sidecars`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    })
    if (!sidecars.ok) throw new Error(`poster failed: ${sidecars.status}`)
  }

  return video.id
}

export { writeFile }
