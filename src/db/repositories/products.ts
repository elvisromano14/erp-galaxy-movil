import { sql } from 'drizzle-orm';
import type { AppDb } from '../types';
import { normalizeText } from '../../sync/normalize';

export interface ProductRow {
  id: string; sku: string; name: string; categoryName: string | null; unitCode: string | null; isService: boolean;
  /** Precio vigente de la lista por omisión (texto decimal) o null si no tiene. */
  price: string | null;
  /** Existencia disponible total (cantidad − reservado), solo para mostrar en listas. */
  available: number;
}

export interface SearchOptions { query?: string; limit?: number; offset?: number; inStockOnly?: boolean; today: string }

const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Lista de precios por omisión de la empresa (la que muestra el listado). */
export function defaultPriceListId(db: AppDb): string | null {
  const r = db.all<{ id: string }>(sql`SELECT id FROM price_lists ORDER BY is_default DESC, code LIMIT 1`);
  return r[0]?.id ?? null;
}

/** Moneda de la lista de precios por omisión (la de los precios del listado). */
export function defaultCurrency(db: AppDb): { symbol: string; decimals: number; code: string } | null {
  return db.all<{ symbol: string; decimals: number; code: string }>(sql`
    SELECT c.symbol, c.decimals, c.code FROM price_lists l JOIN currencies c ON c.id = l.currency_id ORDER BY l.is_default DESC, l.code LIMIT 1`)[0] ?? null;
}

export function productCount(db: AppDb): number {
  return db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM products WHERE is_active = 1`)[0]?.n ?? 0;
}

/**
 * Búsqueda por SKU, nombre, referencias OEM/equivalentes y códigos de barras (todo está en `search_text`, normalizado sin tildes):
 * cada palabra debe aparecer (AND). Orden: SKU exacto, SKU que empieza igual, luego por nombre.
 */
export function searchProducts(db: AppDb, o: SearchOptions): ProductRow[] {
  const q = normalizeText(o.query);
  const tokens = q ? q.split(' ') : [];
  const listId = defaultPriceListId(db);
  const where = [sql`p.is_active = 1`, ...tokens.map((t) => sql`p.search_text LIKE ${'%' + esc(t) + '%'} ESCAPE '\\'`)];
  if (o.inStockOnly) where.push(sql`(SELECT COALESCE(SUM(CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL)), 0) FROM stock_snapshots s WHERE s.product_id = p.id) > 0`);
  const rows = db.all<Omit<ProductRow, 'isService'> & { isService: number }>(sql`
    SELECT p.id, p.sku, p.name, p.category_name AS categoryName, p.unit_code AS unitCode, p.is_service AS isService,
      (SELECT pp.price FROM product_prices pp WHERE pp.product_id = p.id AND pp.price_list_id = ${listId} AND pp.valid_from <= ${o.today}
        ORDER BY pp.valid_from DESC LIMIT 1) AS price,
      (SELECT COALESCE(SUM(CAST(s.quantity AS REAL) - CAST(s.reserved AS REAL)), 0) FROM stock_snapshots s WHERE s.product_id = p.id) AS available
    FROM products p
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY CASE WHEN lower(p.sku) = ${q} THEN 0 WHEN lower(p.sku) LIKE ${esc(q) + '%'} ESCAPE '\\' THEN 1 ELSE 2 END, p.name
    LIMIT ${o.limit ?? 50} OFFSET ${o.offset ?? 0}`);
  return rows.map((r) => ({ ...r, isService: !!r.isService }));
}

/** Producto por código escaneado: código de barras, luego SKU exacto y por último referencia OEM exacta. */
export function findByCode(db: AppDb, code: string): { id: string; sku: string; name: string } | null {
  const c = code.trim();
  if (!c) return null;
  const hit = (cond: ReturnType<typeof sql>) => db.all<{ id: string; sku: string; name: string }>(sql`${cond} LIMIT 1`)[0] ?? null;
  return (
    hit(sql`SELECT p.id, p.sku, p.name FROM product_refs r JOIN products p ON p.id = r.product_id WHERE r.kind = 'BARCODE' AND r.code = ${c} AND p.is_active = 1`) ??
    hit(sql`SELECT p.id, p.sku, p.name FROM products p WHERE lower(p.sku) = ${c.toLowerCase()} AND p.is_active = 1`) ??
    hit(sql`SELECT p.id, p.sku, p.name FROM product_refs r JOIN products p ON p.id = r.product_id WHERE lower(r.code) = ${c.toLowerCase()} AND p.is_active = 1`)
  );
}

export interface PriceLine { priceListId: string; listCode: string; listName: string; isDefault: boolean; price: string; validFrom: string; symbol: string; decimals: number; currencyCode: string }
export interface StockLine { warehouseId: string; code: string; name: string; quantity: string; reserved: string; asOf: string }
export interface ProductDetail {
  id: string; sku: string; name: string; description: string | null; categoryName: string | null; unitCode: string | null; trackingMode: string; isService: boolean;
  tax: { name: string; rate: string } | null;
  references: { kind: string; code: string; brand: string | null }[];
  barcodes: string[];
  prices: PriceLine[];
  stock: StockLine[];
}

export function getProductDetail(db: AppDb, id: string, today: string): ProductDetail | null {
  const p = db.all<{ id: string; sku: string; name: string; description: string | null; categoryName: string | null; unitCode: string | null; trackingMode: string; isService: number; taxName: string | null; taxRate: string | null }>(sql`
    SELECT p.id, p.sku, p.name, p.description, p.category_name AS categoryName, p.unit_code AS unitCode, p.tracking_mode AS trackingMode, p.is_service AS isService,
           t.name AS taxName, t.rate AS taxRate
    FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ${id}`)[0];
  if (!p) return null;
  const refs = db.all<{ kind: string; code: string; brand: string | null }>(sql`SELECT kind, code, brand FROM product_refs WHERE product_id = ${id} ORDER BY kind, code`);
  const prices = db.all<PriceLine>(sql`
    SELECT l.id AS priceListId, l.code AS listCode, l.name AS listName, l.is_default AS isDefault, c.symbol AS symbol, c.decimals AS decimals, c.code AS currencyCode,
      (SELECT pp.price FROM product_prices pp WHERE pp.product_id = ${id} AND pp.price_list_id = l.id AND pp.valid_from <= ${today} ORDER BY pp.valid_from DESC LIMIT 1) AS price,
      (SELECT pp.valid_from FROM product_prices pp WHERE pp.product_id = ${id} AND pp.price_list_id = l.id AND pp.valid_from <= ${today} ORDER BY pp.valid_from DESC LIMIT 1) AS validFrom
    FROM price_lists l LEFT JOIN currencies c ON c.id = l.currency_id ORDER BY l.is_default DESC, l.code`)
    .filter((r) => r.price !== null)
    .map((r) => ({ ...r, isDefault: !!r.isDefault, symbol: r.symbol ?? '', decimals: r.decimals ?? 2, currencyCode: r.currencyCode ?? '' }));
  const stock = db.all<StockLine>(sql`
    SELECT s.warehouse_id AS warehouseId, w.code AS code, w.name AS name, s.quantity AS quantity, s.reserved AS reserved, s.as_of AS asOf
    FROM stock_snapshots s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.product_id = ${id} ORDER BY w.code`);
  return {
    id: p.id, sku: p.sku, name: p.name, description: p.description, categoryName: p.categoryName, unitCode: p.unitCode, trackingMode: p.trackingMode, isService: !!p.isService,
    tax: p.taxName ? { name: p.taxName, rate: p.taxRate ?? '0' } : null,
    references: refs.filter((r) => r.kind !== 'BARCODE'), barcodes: refs.filter((r) => r.kind === 'BARCODE').map((r) => r.code), prices, stock,
  };
}
