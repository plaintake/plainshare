import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { producers, type Producer } from '@/db/schema'
import { errorJson } from '@/lib/api.server'

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Minting material for producer keys (`sk_` + randomHex(12) = 24 hex chars). */
export function randomHex(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The admin gate that producer creation and key re-issue share: the 401/500
 * response, or null when the presented token matches. Double-hashing both sides
 * keeps the comparison off the raw secret.
 */
export async function requireAdmin(request: Request): Promise<Response | null> {
  const adminToken = env.ADMIN_TOKEN
  if (adminToken === undefined || adminToken === '') {
    return errorJson('not-configured', 500)
  }
  const presented = request.headers.get('x-admin-token')
  if (presented === null || (await sha256Hex(presented)) !== (await sha256Hex(adminToken))) {
    return errorJson('unauthorized', 401)
  }
  return null
}

/**
 * Resolves the bearer key to a producer row, or null. Keys are stored only as
 * sha256; the unique-index lookup is the comparison, so there is no
 * timing-sensitive string compare on a secret. After a re-issue the old hash no
 * longer matches the index — the lookup itself is the revocation.
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
