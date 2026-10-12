import { desc, sql } from 'drizzle-orm';
import { PULL_ORDER } from '../../core/api/contract';
import { META, getMeta } from '../../db/meta';
import { counts } from '../../db/repositories/outbox';
import { syncLog } from '../../db/schema';
import type { AppDb } from '../../db/types';

const TABLES = ['products', 'product_refs', 'product_prices', 'stock_snapshots', 'customers', 'sales_documents', 'sales_document_lines', 'outbox', 'taxes', 'exchange_rates', 'price_lists', 'warehouses', 'currencies'] as const;

export interface Diagnostics {
  migrations: number; dbSizeBytes: number; tables: Record<string, number>; cursors: Record<string, string | null>;
  queue: ReturnType<typeof counts>; lastSyncs: { startedAt: string; finishedAt: string | null; ok: boolean }[];
  meta: { companyId: string | null; deviceCode: string | null; bootstrapDoneAt: string | null; lastSyncAt: string | null; revokedAt: string | null };
}

/** Datos de diagnóstico de la base local (pantalla oculta de soporte). No incluye datos de negocio ni personales: solo conteos y estado. */
export function collectDiagnostics(db: AppDb): Diagnostics {
  const one = (q: ReturnType<typeof sql>, key: string) => Number(db.all<Record<string, number>>(q)[0]?.[key] ?? 0);
  let migrations = 0;
  try { migrations = one(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations`, 'n'); } catch { /* sin tabla en pruebas */ }
  const tables = Object.fromEntries(TABLES.map((t) => [t, one(sql.raw(`SELECT COUNT(*) AS n FROM ${t}`), 'n')]));
  return {
    migrations,
    dbSizeBytes: one(sql`PRAGMA page_count`, 'page_count') * one(sql`PRAGMA page_size`, 'page_size'),
    tables,
    cursors: Object.fromEntries(PULL_ORDER.map((e) => [e, getMeta(db, META.cursor(e))])),
    queue: counts(db),
    lastSyncs: db.select().from(syncLog).orderBy(desc(syncLog.id)).limit(5).all().map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok })),
    meta: {
      companyId: getMeta(db, META.companyId), deviceCode: getMeta(db, META.deviceCode), bootstrapDoneAt: getMeta(db, META.bootstrapDoneAt),
      lastSyncAt: getMeta(db, META.lastSyncAt), revokedAt: getMeta(db, META.revokedAt),
    },
  };
}
