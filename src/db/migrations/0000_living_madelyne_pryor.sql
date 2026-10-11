CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`rif` text NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`phone` text,
	`email` text,
	`address` text,
	`price_list_id` text,
	`credit_limit` text DEFAULT '0' NOT NULL,
	`credit_days` integer DEFAULT 0 NOT NULL,
	`balance_snapshot` text DEFAULT '0' NOT NULL,
	`overdue_snapshot` text DEFAULT '0' NOT NULL,
	`validation_status` text DEFAULT 'VALIDATED' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_local` integer DEFAULT false NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_rif` ON `customers` (`rif`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`currency_id` text NOT NULL,
	`rate` text NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`currency_id` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`price_list_id` text NOT NULL,
	`price` text NOT NULL,
	`valid_from` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_prices_product` ON `product_prices` (`product_id`,`price_list_id`);--> statement-breakpoint
CREATE TABLE `product_refs` (
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`brand` text,
	PRIMARY KEY(`product_id`, `kind`, `code`)
);
--> statement-breakpoint
CREATE INDEX `idx_product_refs_code` ON `product_refs` (`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_name` text,
	`unit_code` text,
	`tax_id` text,
	`tracking_mode` text DEFAULT 'NONE' NOT NULL,
	`is_service` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `stock_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` text NOT NULL,
	`reserved` text NOT NULL,
	`as_of` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stock_product` ON `stock_snapshots` (`product_id`);--> statement-breakpoint
CREATE TABLE `taxes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`rate` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_document_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku` text,
	`description` text,
	`quantity` text NOT NULL,
	`unit_price` text NOT NULL,
	`discount_pct` text DEFAULT '0' NOT NULL,
	`tax_id` text,
	`tax_rate` text DEFAULT '0' NOT NULL,
	`line_total` text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_lines_doc` ON `sales_document_lines` (`document_id`);--> statement-breakpoint
CREATE TABLE `sales_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`doc_type` text NOT NULL,
	`customer_id` text NOT NULL,
	`local_number` text,
	`server_number` text,
	`currency_id` text NOT NULL,
	`exchange_rate` text,
	`payment_condition` text DEFAULT 'CASH' NOT NULL,
	`credit_days` integer DEFAULT 0 NOT NULL,
	`warehouse_id` text,
	`valid_until` text,
	`notes` text,
	`source_document_id` text,
	`subtotal` text DEFAULT '0' NOT NULL,
	`tax_total` text DEFAULT '0' NOT NULL,
	`total` text DEFAULT '0' NOT NULL,
	`local_status` text DEFAULT 'DRAFT' NOT NULL,
	`server_status` text,
	`sync_error` text,
	`created_at_device` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_docs_type_status` ON `sales_documents` (`doc_type`,`local_status`);--> statement-breakpoint
CREATE INDEX `idx_docs_customer` ON `sales_documents` (`customer_id`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`client_op_id` text PRIMARY KEY NOT NULL,
	`client_seq` integer NOT NULL,
	`entity` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_client_seq_unique` ON `outbox` (`client_seq`);--> statement-breakpoint
CREATE INDEX `idx_outbox_status_seq` ON `outbox` (`status`,`client_seq`);--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer DEFAULT false NOT NULL,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
