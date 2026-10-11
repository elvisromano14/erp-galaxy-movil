import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Cola de operaciones salientes. Cada escritura de negocio = transacción que modifica el documento Y agrega aquí. */
export const outbox = sqliteTable('outbox', {
  clientOpId: text('client_op_id').primaryKey(),
  clientSeq: integer('client_seq').notNull().unique(),
  /** customer | sales_quote | sales_order */
  entity: text('entity').notNull(),
  /** create | update */
  action: text('action').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  /** PENDING | SENDING | DONE | REJECTED | REVIEW */
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_outbox_status_seq').on(t.status, t.clientSeq)]);

/** Pares clave/valor: cursores por entidad, deviceId/deviceCode, contador local (local_seq), schema_version, company_id… */
export const syncMeta = sqliteTable('sync_meta', { key: text('key').primaryKey(), value: text('value').notNull() });

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  ok: integer('ok', { mode: 'boolean' }).notNull().default(false),
  summary: text('summary'),
});
