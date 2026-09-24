import { createFileRoute } from '@tanstack/react-router'
import { errorJson, json } from '@/lib/api.server'
import { requireAdmin } from '@/lib/auth.server'
import { runRetention } from '@/lib/retention.server'

/**
 * Runs the cron's retention pass now. An ops tool (purge after a takedown
 * without waiting a day) and the e2e hook: `{"graceDays": 0}` purges every
 * tombstone immediately.
 */
export const Route = createFileRoute('/api/admin/retention')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gate = await requireAdmin(request)
        if (gate !== null) return gate

        let graceDays: number | undefined
        const raw = await request.text()
        if (raw.trim() !== '') {
          let body: unknown
          try {
            body = JSON.parse(raw)
          } catch {
            return errorJson('invalid-json', 400)
          }
          if (body !== null && typeof body === 'object' && 'graceDays' in body) {
            const value = (body as { graceDays: unknown }).graceDays
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
              return errorJson('invalid-grace-days', 400)
            }
            graceDays = value
          }
        }

        return json(await runRetention(new Date(), graceDays))
      },
    },
  },
})
