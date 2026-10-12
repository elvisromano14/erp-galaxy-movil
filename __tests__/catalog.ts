import type { PullEntity, PullPage } from '../src/core/api/contract';
import { META, setMeta } from '../src/db/meta';
import { SqlitePullStore } from '../src/sync/SqlitePullStore';
import { createTestDb } from './testDb';

export const TODAY = '2026-10-11';
const page = (entity: PullEntity, items: unknown[], fullRefresh = false): PullPage => ({ entity, items: items as never, nextCursor: null, hasMore: false, fullRefresh, serverTime: 'x' });

/** Catálogo de prueba: USD/VES, lista MAY (USD), IVA 16 % y exento, 3 productos con precio y existencia, un cliente con crédito y políticas del vendedor. */
export async function seedCatalog(settings: Record<string, unknown> = {}) {
  const { db } = createTestDb(); const st = new SqlitePullStore(db);
  await st.applyPage(page('app_settings', [{
    company: { id: 'co1', rif: 'J-12345678-4', legalName: 'Repuestos Galaxy, C.A.', tradeName: 'Galaxy Repuestos', baseCurrencyId: 'ves', valuationCurrencyId: 'usd' },
    seller: { id: 's1', code: 'V01', name: 'Vendedor Uno' }, sellerScope: 'OWN', defaultWarehouseId: 'w1', allowPriceEdit: false, maxDiscountPct: '10', allowCustomerCreate: true, pricePolicy: 'SERVER_LIST', ...settings,
  }], true), null);
  setMeta(db, META.deviceCode, 'D07');
  await st.applyPage(page('currencies', [{ id: 'usd', code: 'USD', name: 'Dólar', symbol: '$', decimals: 2 }, { id: 'ves', code: 'VES', name: 'Bolívar', symbol: 'Bs', decimals: 2 }], true), null);
  await st.applyPage(page('exchange_rates', [{ id: 'r1', currencyId: 'usd', rate: '40', date: TODAY, source: 'BCV' }], true), null);
  await st.applyPage(page('price_lists', [{ id: 'L1', code: 'MAY', name: 'Mayorista', currencyId: 'usd', isDefault: true }], true), null);
  await st.applyPage(page('warehouses', [{ id: 'w1', code: 'PRI', name: 'Principal', isActive: true }], true), null);
  await st.applyPage(page('taxes', [
    { id: 't16', code: 'IVA_GENERAL', name: 'IVA 16 %', kind: 'VAT', rate: '16', validFrom: '2020-01-01', isActive: true },
    { id: 'tex', code: 'EXENTO', name: 'Exento', kind: 'EXEMPT', rate: '0', validFrom: '2020-01-01', isActive: true },
  ], true), null);
  const prod = (id: string, sku: string, name: string, taxId: string, extra: object = {}) => ({ id, sku, name, categoryName: 'Frenos', unitCode: 'UND', taxId, isActive: true, version: 1, refs: [], barcodes: [], ...extra });
  await st.applyPage(page('products', [prod('p1', 'PAS-001', 'Pastilla de freno', 't16'), prod('p2', 'FIL-002', 'Filtro de aceite', 't16'), prod('p3', 'LIB-003', 'Libro técnico (exento)', 'tex'), prod('p4', 'OLD-004', 'Descontinuado', 't16', { isActive: false })]), 'c');
  await st.applyPage(page('product_prices', [
    { id: 'a', productId: 'p1', priceListId: 'L1', price: '20', validFrom: '2026-01-01' },
    { id: 'b', productId: 'p2', priceListId: 'L1', price: '10', validFrom: '2026-01-01' },
    { id: 'c', productId: 'p3', priceListId: 'L1', price: '5', validFrom: '2026-01-01' },
  ]), 'c');
  await st.applyPage(page('stock_snapshots', [
    { id: 's1', productId: 'p1', warehouseId: 'w1', quantity: '10', reserved: '2', asOf: '2026-10-11T10:00:00.000Z' },
    { id: 's2', productId: 'p2', warehouseId: 'w1', quantity: '100', reserved: '0', asOf: '2026-10-11T10:00:00.000Z' },
    { id: 's3', productId: 'p3', warehouseId: 'w1', quantity: '3', reserved: '0', asOf: '2026-10-11T10:00:00.000Z' },
  ]), 'c');
  await st.applyPage(page('customers', [{ id: 'c1', rif: 'J-30000000-1', legalName: 'Repuestos El Sol, C.A.', phone: '0212-5551234', address: 'Av. Principal', creditLimit: '10000', creditDays: 15, balanceSnapshot: '2000', overdueSnapshot: '0', validationStatus: 'VALIDATED', isActive: true, version: 1 }]), 'c');
  return db;
}
