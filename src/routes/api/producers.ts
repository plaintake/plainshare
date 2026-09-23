import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { env } from 'cloudflare:workers'
import { db } from '@/db'
import { producers } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { sha256Hex } from '@/lib/auth.server'

const CreateProducerSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes'),
  homepageUrl: z.url().optional(),
})

function randomHex(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The whole producer lifecycle for v1: an admin (holding ADMIN_TOKEN) registers
 * a producer and receives its bearer key exactly once — only sha256(key) is
 * stored, so a lost key means minting a new producer row.
 */
export const Route = createFileRoute('/api/producers')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const adminToken = env.ADMIN_TOKEN
        if (adminToken === undefined || adminToken === '') {
          return errorJson('not-configured', 500)
        }
        const presented = request.headers.get('x-admin-token')
        if (presented === null || (await sha256Hex(presented)) !== (await sha256Hex(adminToken))) {
          return errorJson('unauthorized', 401)
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return errorJson('invalid-json', 400)
        }
        const parsed = CreateProducerSchema.safeParse(body)
        if (!parsed.success) {
          return errorJson(`invalid-producer: ${parsed.error.issues[0]?.message ?? 'validation failed'}`, 400)
        }

        const existing = await db
          .select({ id: producers.id })
          .from(producers)
          .where(eq(producers.slug, parsed.data.slug))
          .limit(1)
        if (existing.length > 0) {
          return errorJson('slug-taken', 409)
        }

        const key = `sk_${randomHex(12)}`
        const inserted = await db
          .insert(producers)
          .values({
            id: crypto.randomUUID(),
            slug: parsed.data.slug,
            name: parsed.data.name,
            homepageUrl: parsed.data.homepageUrl ?? null,
            keyHash: await sha256Hex(key),
          })
          .returning({ id: producers.id, slug: producers.slug, name: producers.name })
        const row = inserted[0]!

        return json({ id: row.id, slug: row.slug, name: row.name, key }, 201)
      },
    },
  },
})
