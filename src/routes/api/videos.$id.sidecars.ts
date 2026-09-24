import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { videos } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { requireProducer } from '@/lib/auth.server'
import { parseChapters } from '@/lib/chapters'
import { isVideoId } from '@/lib/ids'
import { captionsKey, posterKey } from '@/lib/r2keys'
import { findVideo } from '@/lib/videos.server'
import { parseExpiresAt, videoState } from '@/lib/visibility'
import { validateVttOrThrow } from '@/lib/vtt'

const MAX_SIDECAR_TOTAL = 5 * 1024 * 1024 // formData buffers; cap before parsing
const MAX_PART_BYTES = 2 * 1024 * 1024 // captions and poster individually

async function partBytes(part: FormDataEntryValue | null): Promise<Uint8Array | null> {
  if (part === null) return null
  if (typeof part === 'string') return new TextEncoder().encode(part)
  if (part.size > MAX_PART_BYTES) throw new Error('part exceeds 2 MiB')
  return new Uint8Array(await part.arrayBuffer())
}

/**
 * Attach sidecars to an uploaded video: WebVTT captions (stored byte-identical,
 * validated with parseVtt), chapters JSON, a poster JPEG, a title, and an
 * expiry (`expiresAt`: ISO-8601, or `none` to clear). Only the
 * owning producer may write; every part is optional but at least one is
 * required. Re-sending a part is an idempotent overwrite of the same key.
 */
export const Route = createFileRoute('/api/videos/$id/sidecars')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const id = params.id
        if (!isVideoId(id)) return errorJson('invalid-id', 400)

        const producer = await requireProducer(request)
        if (producer === null) return errorJson('unauthorized', 401)

        const row = await findVideo(id)
        if (row === null) return errorJson('not-found', 404)
        if (row.producerId !== producer.id) return errorJson('forbidden', 403)
        // Restore first (POST /restore or a re-PUT); writes never revive a video.
        const state = videoState(row, new Date())
        if (state !== 'live') return errorJson(state, 410)

        const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
        if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_SIDECAR_TOTAL) {
          return errorJson('too-large', 413)
        }

        let form: FormData
        try {
          form = await request.formData()
        } catch {
          return errorJson('invalid-form-data', 400)
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() }
        let touched = 0

        const captions = form.get('captions')
        if (captions !== null) {
          let bytes: Uint8Array
          try {
            const parsed = await partBytes(captions)
            if (parsed === null) throw new Error('unreachable')
            bytes = parsed
          } catch (error) {
            const reason = error instanceof Error && error.message.includes('2 MiB') ? 'too-large' : 'invalid-part'
            return errorJson(reason, reason === 'too-large' ? 413 : 400)
          }
          const text = new TextDecoder().decode(bytes)
          try {
            validateVttOrThrow(text)
          } catch (error) {
            return errorJson(`invalid-captions: ${error instanceof Error ? error.message : 'parse failed'}`, 400)
          }
          await env.BUCKET.put(captionsKey(id), bytes, {
            httpMetadata: { contentType: 'text/vtt; charset=utf-8' },
          })
          updates.hasCaptions = true
          touched += 1
        }

        const chapters = form.get('chapters')
        if (chapters !== null) {
          let parsed: unknown
          try {
            const raw = typeof chapters === 'string' ? chapters : new TextDecoder().decode(await chapters.arrayBuffer())
            parsed = JSON.parse(raw)
          } catch {
            return errorJson('invalid-chapters-json', 400)
          }
          let normalized: string
          try {
            normalized = JSON.stringify(parseChapters(parsed, row.durationMs ?? undefined))
          } catch (error) {
            return errorJson(`invalid-chapters: ${error instanceof Error ? error.message : 'validation failed'}`, 400)
          }
          updates.chapters = normalized
          touched += 1
        }

        const poster = form.get('poster')
        if (poster !== null) {
          if (typeof poster === 'string') return errorJson('poster-must-be-a-file', 400)
          if (poster.size > MAX_PART_BYTES) return errorJson('too-large', 413)
          const bytes = new Uint8Array(await poster.arrayBuffer())
          // JPEG magic bytes — rejecting mislabeled files cheaply, before storage.
          if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
            return errorJson('poster-not-jpeg', 400)
          }
          await env.BUCKET.put(posterKey(id), bytes, {
            httpMetadata: { contentType: 'image/jpeg' },
          })
          updates.hasPoster = true
          touched += 1
        }

        const title = form.get('title')
        if (typeof title === 'string' && title.trim() !== '') {
          updates.title = title.trim().slice(0, 200)
          touched += 1
        }

        const expiresAt = form.get('expiresAt')
        if (typeof expiresAt === 'string' && expiresAt.trim() !== '') {
          let parsed: Date | 'clear'
          try {
            parsed = parseExpiresAt(expiresAt, new Date())
          } catch {
            return errorJson('invalid-expires-at', 400)
          }
          updates.expiresAt = parsed === 'clear' ? null : parsed
          touched += 1
        }

        if (touched === 0) return errorJson('no-parts', 400)

        await db.update(videos).set(updates).where(eq(videos.id, id))
        return json({
          id,
          hasCaptions: (updates.hasCaptions as boolean | undefined) ?? row.hasCaptions,
          hasChapters: updates.chapters !== undefined ? true : row.chapters !== null,
          hasPoster: (updates.hasPoster as boolean | undefined) ?? row.hasPoster,
          expiresAt:
            'expiresAt' in updates
              ? ((updates.expiresAt as Date | null)?.toISOString() ?? null)
              : (row.expiresAt?.toISOString() ?? null),
        })
      },
    },
  },
})
