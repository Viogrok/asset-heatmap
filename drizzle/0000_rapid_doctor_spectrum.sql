CREATE TABLE `quote_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`owner` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
