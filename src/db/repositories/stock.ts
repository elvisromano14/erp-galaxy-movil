import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { normalizeText } from '../../sync/normalize';
import type { AppDb } from '../types';

const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface StockRow { productId: string; sku: string; name: string; unitCode: string | null; warehouseId: string; warehouseCode: string; quantity: string; reserved: string; available: string; asOf: string }
export interface StockFilter { query?: string; warehouseId?: string | null; onlyPositive?: boolean; onlyEmpty?: boolean; limit?: number; offset?: number }
export interface StockSummary { lines: number; products: number; units: string; reserved: string }

function whereOf(f: StockFilter) {
  const where = [sql`p.is_active = 1`, sql`p.is_service = 0`];
  if (f.warehouseId) where.push(sql`s.warehouse_id = ${f.warehouseId}`);
  for (const t of normalizeText(f.query).split(' ').filter(Boolean)) where.push(sql`p.search_text LIKE ${'%' + esc(t) + '%'} ESCAPE '\\'`);
  if (f.onlyPositive) where.push(sql`CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL) > 0`);
  if (f.onlyEmpty) where.push(sql`CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL) <= 0`);
  return sql.join(where, sql` AND `);
}

/** Existencia por producto y depósito (la que bajó con la última sincronización); equivale a la vista «Existencias» de la web, sin costos. */
export function listStock(db: AppDb, f: StockFilter = {}): StockRow[] {
  return db.all<Omit<StockRow, 'available'>>(sql`
    SELECT p.id AS productId, p.sku, p.name, p.unit_code AS unitCode, s.warehouse_id AS warehouseId, w.code AS warehouseCode, s.quantity, s.reserved, s.as_of AS asOf
    FROM stock_snapshots s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
    WHERE ${whereOf(f)} ORDER BY p.name, w.code LIMIT ${f.limit ?? 50} OFFSET ${f.offset ?? 0}`)
    .map((r) => ({ ...r, available: new Decimal(r.quantity).minus(r.reserved).toString() }));
}

export function stockSummary(db: AppDb, f: StockFilter = {}): StockSummary {
  const rows = db.all<{ productId: string; quantity: string; reserved: string }>(sql`
    SELECT p.id AS productId, s.quantity, s.reserved FROM stock_snapshots s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id WHERE ${whereOf(f)}`);
  let units = new Decimal(0), reserved = new Decimal(0);
  for (const r of rows) { units = units.plus(r.quantity); reserved = reserved.plus(r.reserved); }
  return { lines: rows.length, products: new Set(rows.map((r) => r.productId)).size, units: units.toString(), reserved: reserved.toString() };
}

export function listWarehouses(db: AppDb): { id: string; code: string; name: string }[] {
  return db.all<{ id: string; code: string; name: string }>(sql`SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY code`);
}
