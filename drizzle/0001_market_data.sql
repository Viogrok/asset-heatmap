CREATE TABLE IF NOT EXISTS market_data_leases (
 `key` text PRIMARY KEY NOT NULL,
 `owner` text NOT NULL,
 `expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_data_budgets (
 `key` text PRIMARY KEY NOT NULL,
 `window` integer NOT NULL,
 `used` integer NOT NULL
);
