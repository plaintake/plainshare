import { createFileRoute } from '@tanstack/react-router'
import { errorJson, json } from '@/lib/api.server'
import { requireProducer } from '@/lib/auth.server'

/**
 * Who a bearer key resolves to. This is the verify-without-upload primitive a
 * publisher needs after its key was rotated: a 200 proves the presented key
 * still matches this producer row, a 401 proves it does not. No keyHash in the
 * answer — identity only.
 */
export const Route = createFileRoute('/api/producers/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const producer = await requireProducer(request)
        if (producer === null) return errorJson('unauthorized', 401)
        return json({ id: producer.id, slug: producer.slug, name: producer.name })
      },
    },
  },
})
