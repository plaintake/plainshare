ALTER TABLE `videos` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `videos` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `idx_videos_deleted_at` ON `videos` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_videos_expires_at` ON `videos` (`expires_at`);