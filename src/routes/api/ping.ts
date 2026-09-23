import { createFileRoute } from '@tanstack/react-router'
import { json } from '@/lib/api.server'

export const Route = createFileRoute('/api/ping')({
  server: {
    handlers: {
      GET: async () => json({ ok: true }),
    },
  },
})
