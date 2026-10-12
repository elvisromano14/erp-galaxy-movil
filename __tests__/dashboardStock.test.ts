import { sql } from 'drizzle-orm';
import { TODAY, seedCatalog } from './catalog';
import { type DraftInput, saveDraft, submitDocument } from '../src/db/repositories/documents';
import { dashboardStats } from '../src/db/repositories/stats';
import { listStock, listWarehouses, stockSummary } from '../src/db/repositories/stock';

const NOW = new Date(`${TODAY}T15:00:00Z`);
const line = (productId: string, quantity: string, unitPrice: string) => ({ productId, sku: productId.toUpperCase(), description: null, quantity, unitPrice, discountPct: '0', taxId: 't16', taxRate: '16' });
const draft = (docType: 'QUOTE' | 'ORDER', lines: DraftInput['lines']): DraftInput => ({ docType, customerId: 'c1', currencyId: 'usd', paymentCondition: 'CASH', creditDays: 0, validUntil: docType === 'QUOTE' ? '2026-10-26' : null, notes: null, warehouseId: 'w1', lines });

describe('existencias (visor)', () => {
  it('lista por producto y depósito con disponible = cantidad − reservado, sin servicios ni inactivos', async () => {
    const db = await seedCatalog();
    const rows = listStock(db);
    expect(rows.map((r) => [r.sku, r.available])).toEqual([['FIL-002', '100'], ['LIB-003', '3'], ['PAS-001', '8']]); // por nombre: Filtro, Libro, Pastilla
    expect(rows.find((r) => r.sku === 'PAS-001')).toMatchObject({ quantity: '10', reserved: '2', available: '8', warehouseId: 'w1' });
    expect(rows).toHaveLength(3);
  });

  it('filtros: texto, solo con existencia, agotados y depósito', async () => {
    const db = await seedCatalog();
    db.run(sql`INSERT INTO warehouses (id, code, name, is_active) VALUES ('w2', 'SEC', 'Secundario', 1)`);
    db.run(sql`INSERT INTO stock_snapshots (id, product_id, warehouse_id, quantity, reserved, as_of) VALUES ('s9', 'p1', 'w2', '2', '2', '2026-10-11T10:00:00.000Z')`);
    expect(listStock(db, { query: 'pastilla' })).toHaveLength(2);
    expect(listStock(db, { warehouseId: 'w2' }).map((r) => r.sku)).toEqual(['PAS-001']);
    expect(listStock(db, { onlyEmpty: true }).map((r) => [r.sku, r.warehouseCode])).toEqual([['PAS-001', 'SEC']]);
    expect(listStock(db, { onlyPositive: true })).toHaveLength(3);
    expect(listWarehouses(db).map((w) => w.code)).toEqual(['PRI', 'SEC']);
    expect(stockSummary(db)).toEqual({ lines: 4, products: 3, units: '115', reserved: '4' });
  });

  it('un texto con % o _ se toma literal y paginar no repite filas', async () => {
    const db = await seedCatalog();
    expect(listStock(db, { query: '%' })).toHaveLength(0);
    const all = listStock(db);
    expect([...listStock(db, { limit: 2 }), ...listStock(db, { limit: 2, offset: 2 })]).toEqual(all);
  });
});

describe('tablero de inicio', () => {
  it('cuenta catálogo, clientes, agotados, borradores y totales del mes por moneda (sin rechazados)', async () => {
    const db = await seedCatalog();
    expect(dashboardStats(db, '2026-10-01')).toMatchObject({ products: 3, customers: 1, outOfStock: 0, drafts: 0, quotes: { count: 0, byCurrency: [] }, orders: { count: 0 } });

    const q1 = saveDraft(db, draft('QUOTE', [line('p1', '2', '20')]), NOW); submitDocument(db, q1, NOW);
    saveDraft(db, draft('QUOTE', [line('p2', '1', '10')]), NOW);
    const o1 = saveDraft(db, draft('ORDER', [line('p2', '3', '10')]), NOW); submitDocument(db, o1, NOW);
    const s = dashboardStats(db, '2026-10-01');
    expect(s.quotes.count).toBe(2);
    expect(s.quotes.byCurrency).toEqual([{ currencyId: 'usd', total: '58.0000' }]); // 46,40 + 11,60
    expect(s.orders).toEqual({ count: 1, byCurrency: [{ currencyId: 'usd', total: '34.8000' }] });
    expect(s.drafts).toBe(1);
    // meses anteriores no cuentan; los rechazados tampoco
    expect(dashboardStats(db, '2026-11-01').quotes.count).toBe(0);
    db.run(sql`UPDATE sales_documents SET local_status = 'REJECTED' WHERE id = ${q1}`);
    expect(dashboardStats(db, '2026-10-01').quotes.count).toBe(1);
  });

  it('un producto con todo reservado cuenta como agotado; los servicios no', async () => {
    const db = await seedCatalog();
    db.run(sql`UPDATE stock_snapshots SET reserved = '10' WHERE product_id = 'p1'`);
    expect(dashboardStats(db, '2026-10-01').outOfStock).toBe(1);
    db.run(sql`UPDATE products SET is_service = 1 WHERE id = 'p1'`);
    expect(dashboardStats(db, '2026-10-01').outOfStock).toBe(0);
  });
});
