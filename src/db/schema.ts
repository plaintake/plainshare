import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * A producer is an uploading tool (PlainTake today, other captioned-video tools
 * later). The bearer key is never stored — only sha256(key) — and lookups go
 * through the unique keyHash index, so the index compare is the compare.
 */
export const producers = sqliteTable('producers', {
  id: text('id').primaryKey(),
  /** URL-safe slug shown on share pages ("made with <name>"). */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  homepageUrl: text('homepage_url'),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * One row per shared video. Row existence means the MP4 is verified and stored:
 * rows are written only after R2 accepted the object with a matching sha256.
 * Captions/poster R2 keys are derived from the id (see src/lib/r2keys.ts), so
 * only presence flags are stored here.
 */
export const videos = sqliteTable('videos', {
  /** 26-char lowercase base32 of the first 16 sha256 bytes — content-addressed. */
  id: text('id').primaryKey(),
  producerId: text('producer_id')
    .notNull()
    .references(() => producers.id),
  filename: text('filename').notNull(),
  title: text('title'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  bytes: integer('bytes').notNull(),
  /** Full 64-hex sha256 of the MP4, kept for audit and ETags. */
  sha256: text('sha256').notNull(),
  hasCaptions: integer('has_captions', { mode: 'boolean' }).notNull().default(false),
  hasPoster: integer('has_poster', { mode: 'boolean' }).notNull().default(false),
  /** JSON array of {title, startMs, endMs} — see src/lib/chapters.ts. */
  chapters: text('chapters'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Views are events, not a counter: one row per (video, viewer, UTC day).
 * INSERT OR IGNORE makes the increment idempotent by construction; the count is
 * a SELECT COUNT(*) at read time. No drift, no lost-update races.
 */
export const viewEvents = sqliteTable(
  'view_events',
  {
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id),
    /** sha256 of a client viewer id or of ip+user-agent — no raw ids at rest. */
    viewerHash: text('viewer_hash').notNull(),
    /** UTC 'YYYY-MM-DD'; part of the PK so a viewer counts once per day. */
    day: text('day').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.viewerHash, table.day] }),
    index('idx_view_events_video').on(table.videoId),
  ],
)

export type Producer = typeof producers.$inferSelect
export type Video = typeof videos.$inferSelect
export type ViewEvent = typeof viewEvents.$inferSelect
