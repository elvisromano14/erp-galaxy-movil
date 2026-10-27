CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `products` ADD `category_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `unit_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `products` ADD `location_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `min_stock` text;--> statement-breakpoint
ALTER TABLE `products` ADD `max_stock` text;--> statement-breakpoint
ALTER TABLE `products` ADD `is_local` integer DEFAULT false NOT NULL;