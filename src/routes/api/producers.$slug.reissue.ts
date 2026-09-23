import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { producers } from '@/db/schema'
import { errorJson, json } from '@/lib/api.server'
import { randomHex, requireAdmin, sha256Hex } from '@/lib/auth.server'

/**
 * Admin-gated key re-issue on the same producer row: same id, slug, name and
 * ownership of every video it ever uploaded — only the key changes, so a lost
 * key never forces a near-duplicate producer. The old key dies with the UPDATE:
 * lookups go through the unique keyHash index, and the old hash no longer
 * matches it — no grace period, no revocation list. Concurrent re-issues are
 * last-write-wins; only the final epoch's key resolves.
 */
export const Route = createFileRoute('/api/producers/$slug/reissue')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const gate = await requireAdmin(request)
        if (gate !== null) return gate

        // Same shape CreateProducerSchema enforces on the way in.
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(params.slug)) {
          return errorJson('invalid-slug', 400)
        }

        const existing = await db
          .select({ id: producers.id })
          .from(producers)
          .where(eq(producers.slug, params.slug))
          .limit(1)
        if (existing.length === 0) {
          return errorJson('not-found', 404)
        }

        const key = `sk_${randomHex(12)}`
        const updated = await db
          .update(producers)
          .set({ keyHash: await sha256Hex(key), rotatedAt: new Date() })
          .where(eq(producers.slug, params.slug))
          .returning({ id: producers.id, slug: producers.slug, name: producers.name })
        const row = updated[0]!

        return json({ id: row.id, slug: row.slug, name: row.name, key }, 200)
      },
    },
  },
})
