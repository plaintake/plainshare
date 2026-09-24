export type VideoState = 'live' | 'unpublished' | 'expired'

/** The share page's loader data for an unpublished or expired video. */
export type GoneShare = { gone: true; reason: 'unpublished' | 'expired' }

/** Lets the SSR handler (src/server.ts) spot a gone share and answer 410. */
export function isGoneShare(value: unknown): value is GoneShare {
  return typeof value === 'object' && value !== null && (value as { gone?: unknown }).gone === true
}

type VisibilityFields = {
  deletedAt: Date | null
  deletedBy: 'producer' | 'admin' | 'expired' | null
  expiresAt: Date | null
}

/**
 * The one visibility rule every read path shares. Expiry is judged against the
 * clock, not against the cron sweep, so a TTL takes effect exactly on time; the
 * sweep only turns an already-invisible row into a tombstone for purging.
 */
export function videoState(row: VisibilityFields, now: Date): VideoState {
  if (row.deletedAt !== null) return row.deletedBy === 'expired' ? 'expired' : 'unpublished'
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'live'
}

/**
 * Parses a producer-supplied expiry: an ISO-8601 instant strictly in the
 * future, or `none` to clear. Throws on anything else — a typo'd TTL must not
 * silently mean "keep forever" or "expire now".
 */
export function parseExpiresAt(raw: string, now: Date): Date | 'clear' {
  const trimmed = raw.trim()
  if (trimmed.toLowerCase() === 'none') return 'clear'
  // Date.parse is lenient about bare words; demand an ISO date prefix.
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) throw new Error('not an ISO-8601 instant')
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) throw new Error('not an ISO-8601 instant')
  if (ms <= now.getTime()) throw new Error('must be in the future')
  return new Date(ms)
}
