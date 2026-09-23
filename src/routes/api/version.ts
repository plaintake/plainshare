import { createFileRoute } from '@tanstack/react-router'
import pkg from '../../../package.json'
import { json } from '@/lib/api.server'

export const Route = createFileRoute('/api/version')({
  server: {
    handlers: {
      GET: async () => json({ version: pkg.version }),
    },
  },
})
