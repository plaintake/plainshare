import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8787',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:8787/api/ping',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
