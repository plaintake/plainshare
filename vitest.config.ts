import { defineConfig } from 'vitest/config'

// Plain unit tests over the pure lib modules (ids, vtt, chapters) run in Node.
// HTTP-surface tests live in test/integration (boots `wrangler dev`); viewer
// tests in test/e2e (Playwright). Importing route files here would pull in
// `cloudflare:workers`, which only exists inside workerd.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    tsconfigPaths: true,
  },
})
