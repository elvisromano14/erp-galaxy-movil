import { eq } from 'drizzle-orm';
import type { PullEntity, PullPage } from '../src/core/api/contract';
import { META, getMeta, setMeta } from '../src/db/meta';
import { wipeReplica } from '../src/db/replica';
import { customers, outbox, productRefs, products, salesDocumentLines, salesDocuments, taxes } from '../src/db/schema';
import { normalizeText } from '../src/sync/normalize';
import { SqlitePullStore } from '../src/sync/SqlitePullStore';
import { createTestDb } from './testDb';

const page = (entity: PullEntity, items: unknown[], extra: Partial<PullPage> = {}): PullPage => ({ entity, items: items as never, nextCursor: null, hasMore: false, fullRefresh: false, serverTime: 'x', ...extra });
const product = (n: number, extra: object = {}) => ({ id: `p${n}`, sku: `SKU-${n}`, name: `Pastilla de freno ${n}`, taxId: 't1', trackingMode: 'NONE', isService: false, isActive: true, version: 1, deletedAt: null, refs: [{ kind: 'OEM', code: `OEM${n}`, brand: 'Toyota' }], barcodes: [`75000${n}`], ...extra });

describe('normalizeText', () => {
  it('minúsculas, sin tildes y con espacios colapsados', () => {
    expect(normalizeText('Pastilla  de FRENO', 'Ñandú Córdoba', null, undefined)).toBe('pastilla de freno nandu cordoba');
  });
});

describe('SqlitePullStore', () => {
  it('productos: upsert por versión, referencias/códigos y texto de búsqueda', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('products', [product(1), product(2)]), 'c1');
    expect(db.select().from(products).all()).toHaveLength(2);
    expect(db.select().from(productRefs).where(eq(productRefs.productId, 'p1')).all().map((r) => `${r.kind}:${r.code}`).sort()).toEqual(['BARCODE:750001', 'OEM:OEM1']);
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()!.searchText).toBe('sku-1 pastilla de freno 1 oem1 750001');
    expect(getMeta(db, META.cursor('products'))).toBe('c1');
    // una versión nueva actualiza; una versión VIEJA no pisa
    await store.applyPage(page('products', [product(1, { name: 'Nombre nuevo', version: 3, refs: [], barcodes: [] })]), 'c2');
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()).toMatchObject({ name: 'Nombre nuevo', version: 3 });
    expect(db.select().from(productRefs).where(eq(productRefs.productId, 'p1')).all()).toHaveLength(0); // refs reemplazadas
    await store.applyPage(page('products', [product(1, { name: 'Viejo', version: 2 })]), 'c3');
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()!.name).toBe('Nombre nuevo');
  });

  it('lápidas: el producto/cliente borrado queda inactivo (no se elimina)', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('products', [product(1)]), 'c1');
    await store.applyPage(page('products', [product(1, { version: 2, deletedAt: '2026-10-11T00:00:00Z' })]), 'c2');
    expect(db.select().from(products).get()).toMatchObject({ id: 'p1', isActive: false });
  });

  it('muchas filas: inserta por trozos sin pasar el límite de variables de SQLite', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('products', Array.from({ length: 2500 }, (_, i) => product(i))), 'c1');
    expect(db.select().from(products).all()).toHaveLength(2500);
    expect(db.select().from(productRefs).all()).toHaveLength(5000);
  });

  it('catálogos completos reemplazan la tabla y omiten filas dadas de baja', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    const tax = (id: string, rate: string, extra: object = {}) => ({ id, code: id, name: id, kind: 'VAT', rate, validFrom: '2020-01-01T00:00:00.000Z', validTo: null, isActive: true, deletedAt: null, ...extra });
    await store.applyPage(page('taxes', [tax('a', '16'), tax('b', '8')], { fullRefresh: true }), null);
    expect(db.select().from(taxes).all()).toHaveLength(2);
    await store.applyPage(page('taxes', [tax('a', '16'), tax('b', '8', { deletedAt: 'x' })], { fullRefresh: true }), null);
    expect(db.select().from(taxes).all().map((t) => t.id)).toEqual(['a']);
    expect(db.select().from(taxes).get()!.validFrom).toBe('2020-01-01');
    expect(getMeta(db, META.cursor('taxes'))).toBeNull();
  });

  it('clientes: saldo en instantánea, versión y estado de validación', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('customers', [{ id: 'c1', rif: 'J-12345678-9', legalName: 'Repuestos El Sol, C.A.', creditLimit: '1000', creditDays: 15, balanceSnapshot: '250.5', overdueSnapshot: '0', validationStatus: 'PENDING', isActive: true, version: 2 }]), 'k1');
    expect(db.select().from(customers).get()).toMatchObject({ legalName: 'Repuestos El Sol, C.A.', balanceSnapshot: '250.5', validationStatus: 'PENDING', searchText: 'j-12345678-9 repuestos el sol, c.a.' });
  });

  it('un lote que falla no avanza el cursor ni deja datos a medias (transacción)', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('products', [product(1)]), 'c1');
    await expect(store.applyPage(page('products', [product(2), { ...product(3), sku: undefined }]), 'c2')).rejects.toThrow();
    expect(db.select().from(products).all()).toHaveLength(1);
    expect(getMeta(db, META.cursor('products'))).toBe('c1');
  });

  it('documentos del servidor se guardan con sus líneas; los que tienen cambios locales NO se pisan', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    const doc = (extra: object = {}) => ({ id: 'd1', docType: 'ORDER', number: 'PED-000001', status: 'CONFIRMED', customerId: 'c1', currencyId: 'usd', exchangeRate: '40', paymentCondition: 'CASH', creditDays: 0,
      subtotal: '68', taxTotal: '10.88', total: '78.88', version: 2, updatedAt: '2026-10-11T10:00:00.000Z', parent: { id: 'q1', type: 'QUOTE' },
      lines: [{ id: 'l1', productId: 'p1', sku: 'S1', quantity: '2', unitPrice: '20', discountPct: '5', taxRate: '16', net: '38' }], ...extra });
    await store.applyPage(page('my_documents', [doc()]), 'x1');
    expect(db.select().from(salesDocuments).get()).toMatchObject({ id: 'd1', serverNumber: 'PED-000001', serverStatus: 'CONFIRMED', localStatus: 'SYNCED', sourceDocumentId: 'q1' });
    expect(db.select().from(salesDocumentLines).all()).toHaveLength(1);
    // el servidor cambia el estado → se refleja, sin duplicar líneas
    await store.applyPage(page('my_documents', [doc({ status: 'INVOICED', version: 3 })]), 'x2');
    expect(db.select().from(salesDocuments).get()!.serverStatus).toBe('INVOICED');
    expect(db.select().from(salesDocumentLines).all()).toHaveLength(1);
    // documento local pendiente de sincronizar con el mismo serverId: el pull no lo toca
    db.update(salesDocuments).set({ localStatus: 'PENDING_SYNC', notes: 'editado en el teléfono' }).run();
    await store.applyPage(page('my_documents', [doc({ status: 'CANCELLED', version: 9, notes: 'otro' })]), 'x3');
    expect(db.select().from(salesDocuments).get()).toMatchObject({ localStatus: 'PENDING_SYNC', serverStatus: 'INVOICED', notes: 'editado en el teléfono' });
  });

  it('restablecer réplica borra catálogos y cursores pero conserva el outbox y los documentos con cambios locales', async () => {
    const { db } = createTestDb(); const store = new SqlitePullStore(db);
    await store.applyPage(page('products', [product(1)]), 'c1');
    await store.applyPage(page('my_documents', [{ id: 'dS', docType: 'QUOTE', customerId: 'c', currencyId: 'usd', status: 'SENT', updatedAt: '2026-10-11T10:00:00Z', lines: [] }]), 'x');
    db.insert(salesDocuments).values({ id: 'dL', docType: 'ORDER', customerId: 'c', currencyId: 'usd', localStatus: 'PENDING_SYNC', createdAtDevice: 'now', updatedAt: 'now' }).run();
    db.insert(outbox).values({ clientOpId: 'op1', clientSeq: 1, entity: 'sales_order', action: 'create', entityId: 'dL', payloadJson: '{}', createdAt: 'now' }).run();
    setMeta(db, META.bootstrapDoneAt, 'x');
    wipeReplica(db);
    expect(db.select().from(products).all()).toHaveLength(0);
    expect(db.select().from(salesDocuments).all().map((d) => d.id)).toEqual(['dL']);
    expect(db.select().from(outbox).all()).toHaveLength(1);
    expect(getMeta(db, META.cursor('products'))).toBeNull(); expect(getMeta(db, META.bootstrapDoneAt)).toBeNull();
  });
});
