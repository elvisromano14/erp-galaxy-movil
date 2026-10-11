import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Réplica local (PostgreSQL → SQLite). La escribe solo el pull. Dinero y cantidades como TEXT (decimales exactos, con decimal.js);
// booleanos 0/1; fechas ISO-8601. Ver docs/PLAN-MOVIL.md §6.

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  categoryName: text('category_name'),
  unitCode: text('unit_code'),
  taxId: text('tax_id'),
  trackingMode: text('tracking_mode').notNull().default('NONE'),
  isService: integer('is_service', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  /** Texto normalizado (sin tildes, en minúsculas) con SKU, nombre y referencias para búsqueda. */
  searchText: text('search_text').notNull().default(''),
  version: integer('version').notNull(),
}, (t) => [index('idx_products_sku').on(t.sku)]);

export const productRefs = sqliteTable('product_refs', {
  productId: text('product_id').notNull(),
  /** OEM | EQUIVALENT | ALTERNATE | BARCODE */
  kind: text('kind').notNull(),
  code: text('code').notNull(),
  brand: text('brand'),
}, (t) => [primaryKey({ columns: [t.productId, t.kind, t.code] }), index('idx_product_refs_code').on(t.code)]);

export const productPrices = sqliteTable('product_prices', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  priceListId: text('price_list_id').notNull(),
  price: text('price').notNull(),
  validFrom: text('valid_from').notNull(),
}, (t) => [index('idx_product_prices_product').on(t.productId, t.priceListId)]);

export const stockSnapshots = sqliteTable('stock_snapshots', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  quantity: text('quantity').notNull(),
  reserved: text('reserved').notNull(),
  asOf: text('as_of').notNull(),
}, (t) => [index('idx_stock_product').on(t.productId)]);

export const warehouses = sqliteTable('warehouses', {
  id: text('id').primaryKey(), code: text('code').notNull(), name: text('name').notNull(), isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  rif: text('rif').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  phone: text('phone'), email: text('email'), address: text('address'),
  priceListId: text('price_list_id'),
  creditLimit: text('credit_limit').notNull().default('0'),
  creditDays: integer('credit_days').notNull().default(0),
  /** Instantáneas indicativas (en Bs) al momento de la última sincronización. */
  balanceSnapshot: text('balance_snapshot').notNull().default('0'),
  overdueSnapshot: text('overdue_snapshot').notNull().default('0'),
  validationStatus: text('validation_status').notNull().default('VALIDATED'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  /** El cliente fue creado en este dispositivo y aún no se sincroniza. */
  isLocal: integer('is_local', { mode: 'boolean' }).notNull().default(false),
  searchText: text('search_text').notNull().default(''),
  version: integer('version').notNull().default(1),
}, (t) => [index('idx_customers_rif').on(t.rif)]);

export const taxes = sqliteTable('taxes', {
  id: text('id').primaryKey(), code: text('code').notNull(), name: text('name').notNull(), kind: text('kind').notNull(),
  rate: text('rate').notNull(), validFrom: text('valid_from').notNull(), validTo: text('valid_to'),
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(), currencyId: text('currency_id').notNull(), rate: text('rate').notNull(), date: text('date').notNull(), source: text('source').notNull(),
});

export const priceLists = sqliteTable('price_lists', {
  id: text('id').primaryKey(), code: text('code').notNull(), name: text('name').notNull(), currencyId: text('currency_id').notNull(), isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

/** Una sola fila (id = 1): ajustes de empresa y políticas del vendedor (descuento máximo, edición de precio…). */
export const appSettings = sqliteTable('app_settings', { id: integer('id').primaryKey(), json: text('json').notNull() });
