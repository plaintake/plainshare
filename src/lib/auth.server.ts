import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { producers, type Producer } from '@/db/schema'

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolves the bearer key to a producer row, or null. Keys are stored only as
 * sha256; the unique-index lookup is the comparison, so there is no
 * timing-sensitive string compare on a secret.
 */
export async function requireProducer(request: Request): Promise<Producer | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const key = authorization.slice('Bearer '.length).trim()
  if (key === '') return null
  const keyHash = await sha256Hex(key)
  const rows = await db.select().from(producers).where(eq(producers.keyHash, keyHash)).limit(1)
  return rows[0] ?? null
}
