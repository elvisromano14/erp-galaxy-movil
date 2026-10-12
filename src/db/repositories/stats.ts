import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import type { AppDb } from '../types';

export interface DocTotals { count: number; byCurrency: { currencyId: string; total: string }[] }
export interface DashboardStats {
  products: number;
  customers: number;
  /** Cotizaciones y pedidos del mes (los rechazados no cuentan). */
  quotes: DocTotals;
  orders: DocTotals;
  /** Productos (no servicios) activos sin existencia disponible en ningún depósito. */
  outOfStock: number;
  /** Borradores sin enviar. */
  drafts: number;
}

const n = (db: AppDb, q: ReturnType<typeof sql>) => db.all<{ n: number }>(q)[0]?.n ?? 0;

function totals(db: AppDb, docType: 'QUOTE' | 'ORDER', since: string): DocTotals {
  const rows = db.all<{ currencyId: string; total: string }>(sql`
    SELECT currency_id AS currencyId, total FROM sales_documents
    WHERE doc_type = ${docType} AND local_status <> 'REJECTED' AND created_at_device >= ${since}`);
  const sums = new Map<string, Decimal>();
  for (const r of rows) sums.set(r.currencyId, (sums.get(r.currencyId) ?? new Decimal(0)).plus(r.total));
  return { count: rows.length, byCurrency: [...sums].map(([currencyId, t]) => ({ currencyId, total: t.toFixed(4) })) };
}

/** Cifras del tablero de inicio, todas leídas de la réplica local (sin red). `monthStart` = AAAA-MM-01. */
export function dashboardStats(db: AppDb, monthStart: string): DashboardStats {
  return {
    products: n(db, sql`SELECT COUNT(*) AS n FROM products WHERE is_active = 1`),
    customers: n(db, sql`SELECT COUNT(*) AS n FROM customers WHERE is_active = 1`),
    quotes: totals(db, 'QUOTE', monthStart),
    orders: totals(db, 'ORDER', monthStart),
    outOfStock: n(db, sql`
      SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND p.is_service = 0
        AND (SELECT COALESCE(SUM(CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL)), 0) FROM stock_snapshots s WHERE s.product_id = p.id) <= 0`),
    drafts: n(db, sql`SELECT COUNT(*) AS n FROM sales_documents WHERE local_status = 'DRAFT'`),
  };
}
