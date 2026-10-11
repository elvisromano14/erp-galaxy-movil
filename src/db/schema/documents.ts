import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Documentos del vendedor: los escribe el usuario (borradores/pendientes) y el pull (estado del servidor).

export const salesDocuments = sqliteTable('sales_documents', {
  /** UUID v7 generado en el dispositivo (clientEntityId); tras sincronizar se guarda el id del servidor en `serverId`. */
  id: text('id').primaryKey(),
  serverId: text('server_id'),
  /** QUOTE | ORDER (y BUDGET/INVOICE solo lectura desde el servidor) */
  docType: text('doc_type').notNull(),
  customerId: text('customer_id').notNull(),
  /** OFF-D07-000123 mientras no hay número definitivo. */
  localNumber: text('local_number'),
  serverNumber: text('server_number'),
  currencyId: text('currency_id').notNull(),
  exchangeRate: text('exchange_rate'),
  paymentCondition: text('payment_condition').notNull().default('CASH'),
  creditDays: integer('credit_days').notNull().default(0),
  warehouseId: text('warehouse_id'),
  validUntil: text('valid_until'),
  notes: text('notes'),
  sourceDocumentId: text('source_document_id'),
  subtotal: text('subtotal').notNull().default('0'),
  taxTotal: text('tax_total').notNull().default('0'),
  total: text('total').notNull().default('0'),
  /** DRAFT | PENDING_SYNC | SYNCED | REJECTED | NEEDS_REVIEW */
  localStatus: text('local_status').notNull().default('DRAFT'),
  serverStatus: text('server_status'),
  syncError: text('sync_error'),
  createdAtDevice: text('created_at_device').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => [index('idx_docs_type_status').on(t.docType, t.localStatus), index('idx_docs_customer').on(t.customerId)]);

export const salesDocumentLines = sqliteTable('sales_document_lines', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  productId: text('product_id').notNull(),
  sku: text('sku'),
  description: text('description'),
  quantity: text('quantity').notNull(),
  unitPrice: text('unit_price').notNull(),
  discountPct: text('discount_pct').notNull().default('0'),
  taxId: text('tax_id'),
  taxRate: text('tax_rate').notNull().default('0'),
  lineTotal: text('line_total').notNull().default('0'),
}, (t) => [index('idx_lines_doc').on(t.documentId)]);
