import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { runRetention } from '@/lib/retention.server'
import { isGoneShare } from '@/lib/visibility'

/**
 * SSR status comes from the router, which only knows 200/404/500/redirects.
 * The router has loaded by the time this callback runs, so a share page whose
 * loader resolved to a gone share is re-stamped 410 before rendering.
 */
const startFetch = createStartHandler(async (ctx) => {
  if (ctx.router.stores.matches.get().some((match) => isGoneShare(match.loaderData))) {
    ctx.router.stores.statusCode.set(410)
  }
  return defaultStreamHandler(ctx)
})

/**
 * Worker entry: TanStack Start's fetch handler, plus the cron-driven retention
 * job (wrangler.jsonc `triggers.crons`). TanStack Start picks this file up as
 * its custom server entry; wrangler's `main` points here.
 */
export default {
  // Only the request: Start's second parameter is its own RequestOptions, not
  // the Worker's env (bindings come from `cloudflare:workers` instead).
  fetch(request) {
    return startFetch(request)
  },
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(
      runRetention(new Date()).then((result) => {
        console.log(JSON.stringify({ event: 'retention', ...result }))
      }),
    )
  },
} satisfies ExportedHandler<Env>
