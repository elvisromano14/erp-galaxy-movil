CREATE TABLE `currencies` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer DEFAULT 2 NOT NULL
);
