import { sql } from 'drizzle-orm';
import type { AppDb } from '../../db/types';

/** Lista de precios del cliente (o la predeterminada): el mismo criterio que usa el servidor al calcular el documento. */
export function priceListFor(db: AppDb, customerId: string | null): { id: string; currencyId: string; code: string } | null {
  const own = customerId ? db.all<{ id: string; currencyId: string; code: string }>(sql`
    SELECT l.id, l.currency_id AS currencyId, l.code FROM customers c JOIN price_lists l ON l.id = c.price_list_id WHERE c.id = ${customerId}`)[0] : undefined;
  return own ?? db.all<{ id: string; currencyId: string; code: string }>(sql`SELECT id, currency_id AS currencyId, code FROM price_lists ORDER BY is_default DESC, code LIMIT 1`)[0] ?? null;
}

/** Precio vigente (mayor `validFrom ≤ hoy`) de un producto en una lista; null si no tiene. */
export function priceOf(db: AppDb, productId: string, listId: string | null, today: string): string | null {
  if (!listId) return null;
  return db.all<{ price: string }>(sql`
    SELECT price FROM product_prices WHERE product_id = ${productId} AND price_list_id = ${listId} AND valid_from <= ${today} ORDER BY valid_from DESC LIMIT 1`)[0]?.price ?? null;
}

export interface ProductForLine { id: string; sku: string; name: string; isActive: boolean; isService: boolean; taxId: string | null; taxRate: string; taxExempt: boolean; available: number }

export function productForLine(db: AppDb, productId: string): ProductForLine | null {
  const r = db.all<{ id: string; sku: string; name: string; isActive: number; isService: number; taxId: string | null; rate: string | null; kind: string | null; available: number }>(sql`
    SELECT p.id, p.sku, p.name, p.is_active AS isActive, p.is_service AS isService, p.tax_id AS taxId, t.rate AS rate, t.kind AS kind,
      (SELECT COALESCE(SUM(CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL)), 0) FROM stock_snapshots s WHERE s.product_id = p.id) AS available
    FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ${productId}`)[0];
  if (!r) return null;
  const exempt = !r.taxId || r.kind === 'EXEMPT' || r.kind === 'EXONERATED';
  return { id: r.id, sku: r.sku, name: r.name, isActive: !!r.isActive, isService: !!r.isService, taxId: r.taxId, taxRate: exempt ? '0' : (r.rate ?? '0'), taxExempt: exempt, available: r.available };
}

/** Última tasa de cambio local de una moneda (Bs por unidad) con su fecha; la manual de la empresa gana a la del BCV de la misma fecha. */
export function latestRate(db: AppDb, currencyId: string): { rate: string; date: string; source: string } | null {
  return db.all<{ rate: string; date: string; source: string }>(sql`
    SELECT rate, date, source FROM exchange_rates WHERE currency_id = ${currencyId} ORDER BY date DESC, CASE source WHEN 'MANUAL' THEN 0 ELSE 1 END LIMIT 1`)[0] ?? null;
}

export function currencyOf(db: AppDb, currencyId: string): { id: string; code: string; symbol: string; decimals: number } | null {
  return db.all<{ id: string; code: string; symbol: string; decimals: number }>(sql`SELECT id, code, symbol, decimals FROM currencies WHERE id = ${currencyId}`)[0] ?? null;
}
