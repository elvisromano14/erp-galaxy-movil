import type { PullEntity, PullPage } from '../src/core/api/contract';
import { findByCode, getProductDetail, searchProducts } from '../src/db/repositories/products';
import { SqlitePullStore } from '../src/sync/SqlitePullStore';
import { createTestDb } from './testDb';

const TODAY = '2026-10-11';
const page = (entity: PullEntity, items: unknown[], fullRefresh = false): PullPage => ({ entity, items: items as never, nextCursor: null, hasMore: false, fullRefresh, serverTime: 'x' });

async function seed() {
  const { db } = createTestDb(); const st = new SqlitePullStore(db);
  await st.applyPage(page('currencies', [{ id: 'usd', code: 'USD', name: 'Dólar', symbol: '$', decimals: 2 }, { id: 'ves', code: 'VES', name: 'Bolívar', symbol: 'Bs', decimals: 2 }], true), null);
  await st.applyPage(page('price_lists', [{ id: 'L1', code: 'MAY', name: 'Mayorista', currencyId: 'usd', isDefault: true }, { id: 'L2', code: 'DET', name: 'Detal', currencyId: 'ves', isDefault: false }], true), null);
  await st.applyPage(page('warehouses', [{ id: 'w1', code: 'PRI', name: 'Principal', isActive: true }, { id: 'w2', code: 'SEC', name: 'Secundario', isActive: true }], true), null);
  await st.applyPage(page('taxes', [{ id: 't16', code: 'IVA_GENERAL', name: 'IVA 16 %', kind: 'VAT', rate: '16', validFrom: '2020-01-01', isActive: true }], true), null);
  const prod = (id: string, sku: string, name: string, extra: object = {}) => ({ id, sku, name, categoryName: 'Frenos', unitCode: 'UND', taxId: 't16', isActive: true, version: 1, refs: [], barcodes: [], ...extra });
  await st.applyPage(page('products', [
    prod('p1', 'PAS-001', 'Pastilla de freno delantera', { refs: [{ kind: 'OEM', code: '04465-0K290', brand: 'Toyota' }, { kind: 'EQUIVALENT', code: 'GDB3400', brand: 'TRW' }], barcodes: ['7501234567890'] }),
    prod('p2', 'PAS-002', 'Pastilla de freno trasera', { barcodes: ['7500000000002'] }),
    prod('p3', 'FIL-100', 'Filtro de aceite Ñandú'),
    prod('p4', 'DIS-900', 'Disco de freno ventilado', { isActive: false }),
  ]), 'c');
  await st.applyPage(page('product_prices', [
    { id: 'a', productId: 'p1', priceListId: 'L1', price: '12.5', validFrom: '2026-01-01' },
    { id: 'b', productId: 'p1', priceListId: 'L1', price: '14', validFrom: '2026-10-01' }, // vigente
    { id: 'c', productId: 'p1', priceListId: 'L1', price: '99', validFrom: '2026-12-01' }, // futuro: no aplica
    { id: 'd', productId: 'p1', priceListId: 'L2', price: '510.25', validFrom: '2026-10-01' },
    { id: 'e', productId: 'p2', priceListId: 'L1', price: '9', validFrom: '2026-01-01' },
  ]), 'c');
  await st.applyPage(page('stock_snapshots', [
    { id: 's1', productId: 'p1', warehouseId: 'w1', quantity: '10', reserved: '2', asOf: '2026-10-11T10:00:00.000Z' },
    { id: 's2', productId: 'p1', warehouseId: 'w2', quantity: '5', reserved: '0', asOf: '2026-10-11T09:00:00.000Z' },
    { id: 's3', productId: 'p2', warehouseId: 'w1', quantity: '0', reserved: '0', asOf: '2026-10-11T10:00:00.000Z' },
  ]), 'c');
  return db;
}

describe('búsqueda de productos', () => {
  it('por nombre con varias palabras (AND), sin importar tildes ni mayúsculas', async () => {
    const db = await seed();
    expect(searchProducts(db, { query: 'PASTILLA freno', today: TODAY }).map((r) => r.sku)).toEqual(['PAS-001', 'PAS-002']);
    expect(searchProducts(db, { query: 'nandu', today: TODAY }).map((r) => r.sku)).toEqual(['FIL-100']);
    expect(searchProducts(db, { query: 'ñandú ACEITE', today: TODAY }).map((r) => r.sku)).toEqual(['FIL-100']);
    expect(searchProducts(db, { query: 'zzz', today: TODAY })).toHaveLength(0);
  });

  it('por referencia OEM/equivalente y por código de barras; los inactivos no aparecen', async () => {
    const db = await seed();
    expect(searchProducts(db, { query: '04465-0k290', today: TODAY }).map((r) => r.sku)).toEqual(['PAS-001']);
    expect(searchProducts(db, { query: 'gdb3400', today: TODAY }).map((r) => r.sku)).toEqual(['PAS-001']);
    expect(searchProducts(db, { query: '7500000000002', today: TODAY }).map((r) => r.sku)).toEqual(['PAS-002']);
    expect(searchProducts(db, { query: 'disco', today: TODAY })).toHaveLength(0);
  });

  it('el SKU exacto va primero y luego los que empiezan igual', async () => {
    const db = await seed();
    expect(searchProducts(db, { query: 'pas-002', today: TODAY })[0].sku).toBe('PAS-002');
    expect(searchProducts(db, { query: 'pas', today: TODAY }).map((r) => r.sku)).toEqual(['PAS-001', 'PAS-002']);
  });

  it('los comodines de LIKE en la búsqueda se tratan como texto', async () => {
    const db = await seed();
    expect(searchProducts(db, { query: '%', today: TODAY })).toHaveLength(0);
    expect(searchProducts(db, { query: '_', today: TODAY })).toHaveLength(0);
  });

  it('precio vigente de la lista por omisión (ignora precios futuros) y existencia disponible', async () => {
    const db = await seed();
    const r = searchProducts(db, { query: 'pas-001', today: TODAY })[0];
    expect(r).toMatchObject({ price: '14', available: 13 }); // (10−2) + 5
    expect(searchProducts(db, { query: 'fil-100', today: TODAY })[0]).toMatchObject({ price: null, available: 0 });
  });

  it('solo con existencia y paginación', async () => {
    const db = await seed();
    expect(searchProducts(db, { inStockOnly: true, today: TODAY }).map((r) => r.sku)).toEqual(['PAS-001']);
    expect(searchProducts(db, { limit: 1, offset: 1, today: TODAY })).toHaveLength(1);
  });

  it('búsqueda por código escaneado: barcode, SKU exacto u OEM exacta', async () => {
    const db = await seed();
    expect(findByCode(db, '7501234567890')?.sku).toBe('PAS-001');
    expect(findByCode(db, ' pas-002 ')?.sku).toBe('PAS-002');
    expect(findByCode(db, '04465-0k290')?.sku).toBe('PAS-001');
    expect(findByCode(db, '000')).toBeNull(); expect(findByCode(db, '')).toBeNull();
  });
});

describe('detalle de producto', () => {
  it('precios por lista (vigentes, con moneda), impuesto, referencias, códigos y existencias por depósito', async () => {
    const db = await seed();
    const d = getProductDetail(db, 'p1', TODAY)!;
    expect(d).toMatchObject({ sku: 'PAS-001', unitCode: 'UND', categoryName: 'Frenos', tax: { name: 'IVA 16 %', rate: '16' }, barcodes: ['7501234567890'] });
    expect(d.references.map((r) => `${r.kind}:${r.code}:${r.brand}`)).toEqual(['EQUIVALENT:GDB3400:TRW', 'OEM:04465-0K290:Toyota']);
    expect(d.prices.map((p) => `${p.listCode}:${p.symbol}:${p.price}`)).toEqual(['MAY:$:14', 'DET:Bs:510.25']); // por omisión primero
    expect(d.stock.map((s) => `${s.code}:${s.quantity}/${s.reserved}`)).toEqual(['PRI:10/2', 'SEC:5/0']);
    expect(getProductDetail(db, 'p2', TODAY)!.prices).toHaveLength(1); // sin precio en DET
    expect(getProductDetail(db, 'nope', TODAY)).toBeNull();
  });
});

describe('rendimiento con 50 000 productos', () => {
  it('la búsqueda responde en menos de 200 ms (objetivo del plan, medido en Node)', async () => {
    const db = await seed(); const st = new SqlitePullStore(db);
    const batch = (from: number, n: number) => Array.from({ length: n }, (_, i) => {
      const k = from + i;
      return { id: `x${k}`, sku: `REP-${String(k).padStart(6, '0')}`, name: `Repuesto ${['freno', 'motor', 'suspensión', 'eléctrico'][k % 4]} modelo ${k}`, categoryName: 'Varios', unitCode: 'UND', taxId: 't16', isActive: true, version: 1,
        refs: [{ kind: 'OEM', code: `OEM-${k}`, brand: 'X' }], barcodes: [`75${String(k).padStart(11, '0')}`] };
    });
    for (let f = 0; f < 50_000; f += 2000) await st.applyPage(page('products', batch(f, 2000)), `c${f}`);
    const timeit = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };
    const t1 = timeit(() => searchProducts(db, { query: 'suspension modelo 4999', today: TODAY }));
    const t2 = timeit(() => searchProducts(db, { query: 'rep-025000', today: TODAY }));
    const t3 = timeit(() => searchProducts(db, { query: 'freno', today: TODAY, limit: 50 }));
    const t4 = timeit(() => findByCode(db, '75000000012345'));
    // eslint-disable-next-line no-console
    console.log(`búsqueda 50 000: texto ${t1.toFixed(0)} ms · SKU ${t2.toFixed(0)} ms · palabra común ${t3.toFixed(0)} ms · código de barras ${t4.toFixed(0)} ms`);
    for (const t of [t1, t2, t3, t4]) expect(t).toBeLessThan(200);
    expect(searchProducts(db, { query: 'suspension modelo 4999', today: TODAY }).length).toBeGreaterThan(0);
  });
});
