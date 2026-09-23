import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { producers } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { randomHex, requireAdmin, sha256Hex } from '@/lib/auth.server'

const CreateProducerSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes'),
  homepageUrl: z.url().optional(),
})

/**
 * Producer creation: an admin (holding ADMIN_TOKEN) registers a producer and
 * receives its bearer key exactly once — only sha256(key) is stored. A lost key
 * is re-issued on the same row by the admin via POST /api/producers/$slug/reissue
 * (see producers.$slug.reissue.ts); `me` (producers.me.ts) is how a key holder
 * proves its key without uploading anything.
 */
export const Route = createFileRoute('/api/producers')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gate = await requireAdmin(request)
        if (gate !== null) return gate

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
