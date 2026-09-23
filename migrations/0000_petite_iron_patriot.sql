CREATE TABLE `producers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`homepage_url` text,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `producers_slug_unique` ON `producers` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `producers_key_hash_unique` ON `producers` (`key_hash`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`producer_id` text NOT NULL,
	`filename` text NOT NULL,
	`title` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`has_captions` integer DEFAULT false NOT NULL,
	`has_poster` integer DEFAULT false NOT NULL,
	`chapters` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`producer_id`) REFERENCES `producers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `view_events` (
	`video_id` text NOT NULL,
	`viewer_hash` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`video_id`, `viewer_hash`, `day`),
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_view_events_video` ON `view_events` (`video_id`);