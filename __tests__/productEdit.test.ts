import { eq } from 'drizzle-orm';
import { ApiClient } from '../src/core/api/ApiClient';
import type { OpResult, PullEntity, PullPage, PushOperation } from '../src/core/api/contract';
import { setOutcome } from '../src/db/repositories/outbox';
import {
  createProductLocal, defaultsForNew, getProductForEdit, listCategories, listLocations, listTaxes, listUnits, normalizeProduct, ProductError, remapProduct, updateProductLocal,
} from '../src/db/repositories/productEdit';
import { getProductDetail, searchProducts } from '../src/db/repositories/products';
import { getAppSettings } from '../src/db/repositories/settings';
import { wipeReplica } from '../src/db/replica';
import { outbox, productPrices, productRefs, products } from '../src/db/schema';
import { defaultHandlers } from '../src/sync/handlers';
import { SqlitePullStore } from '../src/sync/SqlitePullStore';
import { SyncEngine } from '../src/sync/SyncEngine';
import { explainError } from '../src/features/documents/explain';
import { seedCatalog, TODAY } from './catalog';
import { fakeFetch, memoryTokens } from './helpers';

const page = (entity: PullEntity, items: unknown[], fullRefresh = false): PullPage => ({ entity, items: items as never, nextCursor: null, hasMore: false, fullRefresh, serverTime: 'x' });

/** Catálogo base + unidades, categorías y ubicaciones que baja el pull nuevo. */
async function seed(settings: Record<string, unknown> = { allowProductCreate: true, allowProductUpdate: true }) {
  const db = await seedCatalog(settings);
  const st = new SqlitePullStore(db);
  await st.applyPage(page('units', [{ id: 'u1', code: 'UND', name: 'Unidad' }, { id: 'u2', code: 'KG', name: 'Kilogramo' }, { id: 'ux', code: 'XX', name: 'Borrada', deletedAt: '2026-01-01' }], true), null);
  await st.applyPage(page('categories', [{ id: 'k1', code: 'BAT', name: 'Baterías', parentId: null }, { id: 'k2', code: 'MOD', name: 'Módulos', parentId: null }], true), null);
  await st.applyPage(page('locations', [{ id: 'l1', code: 'VITRINA', name: 'Vitrina', isActive: true }, { id: 'l2', code: 'P1-E6-P4', name: 'P1-E6-P4', isActive: true }, { id: 'l3', code: 'VIEJA', name: 'Vieja', isActive: false }], true), null);
  return db;
}
const base = { sku: 'MOV-001', name: 'Bujía NGK', unitId: 'u1', taxId: 't16', categoryId: 'k1', brand: 'NGK', locationId: 'l1', price: '12,50', barcodes: ['7599990001', '7599990001', ' 7599990002 '] };

describe('catálogos del pull para productos', () => {
  it('guarda unidades, categorías y ubicaciones (sin las borradas) y los campos nuevos del producto; settings trae los permisos', async () => {
    const db = await seed();
    expect(listUnits(db).map((u) => u.label)).toEqual(['KG · Kilogramo', 'UND · Unidad']);
    expect(listCategories(db).map((c) => c.label)).toEqual(['Baterías', 'Módulos']);
    expect(listLocations(db).map((l) => l.label)).toEqual(['P1-E6-P4', 'VITRINA · Vitrina']); // la inactiva no se ofrece
    expect(listTaxes(db, TODAY).map((t) => t.id)).toEqual(['tex', 't16']);
    expect(getAppSettings(db)).toMatchObject({ allowProductCreate: true, allowProductUpdate: true });
    expect((await seed({})) && getAppSettings(await seed({}))).toMatchObject({ allowProductCreate: false, allowProductUpdate: false });
    await new SqlitePullStore(db).applyPage(page('products', [{ id: 'p9', sku: 'B-1', name: 'Batería 22MR', categoryId: 'k1', categoryName: 'Baterías', unitId: 'u1', unitCode: 'UND', taxId: 't16', brand: 'KTO', locationId: 'l2', minStock: '2', maxStock: '9', version: 3, refs: [], barcodes: [] }]), 'c');
    expect(getProductDetail(db, 'p9', TODAY)).toMatchObject({ brand: 'KTO', location: { code: 'P1-E6-P4' }, minStock: '2', maxStock: '9', version: 3, isLocal: false });
    expect(searchProducts(db, { query: 'kto', today: TODAY }).map((r) => r.sku)).toEqual(['B-1']); // la marca se busca
    expect(defaultsForNew(db, TODAY)).toEqual({ unitId: 'u1', taxId: 't16' });
  });
});

describe('alta de producto en el teléfono', () => {
  it('valida, guarda el producto (usable de inmediato, con precio y códigos) y encola product.create con el contrato del servidor', async () => {
    const db = await seed();
    const p = createProductLocal(db, base, { today: TODAY });
    expect(p).toMatchObject({ sku: 'MOV-001', isLocal: true, version: 1, brand: 'NGK', locationId: 'l1', categoryName: 'Baterías', unitCode: 'UND', isActive: true });
    const op = db.select().from(outbox).get()!;
    expect(op).toMatchObject({ entity: 'product', action: 'create', entityId: p.id, status: 'PENDING' });
    expect(JSON.parse(op.payloadJson)).toEqual({
      sku: 'MOV-001', name: 'Bujía NGK', unitId: 'u1', categoryId: 'k1', taxId: 't16', brand: 'NGK', locationId: 'l1', description: null, isService: false,
      barcodes: ['7599990001', '7599990002'], price: '12.5',
    });
    const row = searchProducts(db, { query: 'ngk', today: TODAY })[0];
    expect(row).toMatchObject({ sku: 'MOV-001', price: '12.5', brand: 'NGK', isLocal: true });
    expect(searchProducts(db, { query: '7599990002', today: TODAY })).toHaveLength(1); // buscable por código de barras
    expect(getProductDetail(db, p.id, TODAY)!.barcodes.sort()).toEqual(['7599990001', '7599990002']);
  });

  it('marca y ubicación son opcionales; sin ellas se envían nulos y el alta es válida', async () => {
    const db = await seed();
    const p = createProductLocal(db, { sku: 'SIN-MARCA', name: 'Sin marca ni ubicación', unitId: 'u1' }, { today: TODAY });
    expect(p).toMatchObject({ brand: null, locationId: null, taxId: null });
    expect(JSON.parse(db.select().from(outbox).get()!.payloadJson)).toMatchObject({ brand: null, locationId: null });
  });

  it('rechaza lo que el servidor rechazaría — sin dejar nada a medias', async () => {
    const db = await seed();
    const bad = (i: Partial<typeof base>, code: string) => expect(() => createProductLocal(db, { ...base, ...i })).toThrow(expect.objectContaining({ code }));
    bad({ sku: ' ' }, 'SKU_REQUIRED'); bad({ sku: 'x'.repeat(61) }, 'SKU_TOO_LONG'); bad({ name: '  ' }, 'NAME_REQUIRED'); bad({ unitId: '' }, 'UNIT_REQUIRED');
    bad({ brand: 'm'.repeat(81) }, 'BRAND_TOO_LONG'); bad({ price: '-1' }, 'INVALID_NUMBER'); bad({ price: 'abc' }, 'INVALID_NUMBER');
    expect(() => createProductLocal(db, { ...base, minStock: '10', maxStock: '5' })).toThrow(expect.objectContaining({ code: 'STOCK_RANGE' }));
    expect(() => createProductLocal(db, { ...base, barcodes: Array.from({ length: 21 }, (_, i) => `B${i}`) })).toThrow(expect.objectContaining({ code: 'TOO_MANY_BARCODES' }));
    expect(db.select().from(products).where(eq(products.sku, 'MOV-001')).all()).toHaveLength(0); expect(db.select().from(outbox).all()).toHaveLength(0);
    expect(db.select().from(productRefs).all().filter((r) => r.kind === 'BARCODE')).toHaveLength(0);
    // SKU repetido (sin distinguir mayúsculas) y código de barras de otro producto
    let dup: unknown; try { createProductLocal(db, { ...base, sku: 'pas-001' }); } catch (e) { dup = e; }
    expect(dup).toBeInstanceOf(ProductError); expect(dup).toMatchObject({ code: 'DUPLICATE_SKU', existingId: 'p1' });
    createProductLocal(db, base, { today: TODAY });
    expect(() => createProductLocal(db, { ...base, sku: 'OTRO', barcodes: ['7599990001'] })).toThrow(expect.objectContaining({ code: 'DUPLICATE_BARCODE' }));
    expect(db.select().from(products).where(eq(products.sku, 'OTRO')).all()).toHaveLength(0);
  });

  it('sin lista de precios descargada no se puede indicar precio (se avisa), pero sí crear sin precio', async () => {
    const db = await seed();
    db.run(require('drizzle-orm').sql`DELETE FROM price_lists`);
    expect(() => createProductLocal(db, base)).toThrow(expect.objectContaining({ code: 'NO_PRICE_LIST' }));
    expect(createProductLocal(db, { ...base, price: '' }, { today: TODAY })).toMatchObject({ sku: 'MOV-001' });
  });

  it('normalizeProduct acepta coma decimal, recorta y deduplica', () => {
    expect(normalizeProduct({ sku: ' A ', name: ' N ', unitId: 'u1', minStock: '1,5', maxStock: '', price: '3,25', barcodes: [' x ', 'x', ''] })).toMatchObject({ sku: 'A', name: 'N', minStock: '1.5', maxStock: null, price: '3.25', barcodes: ['x'] });
  });
});

describe('edición', () => {
  it('antes de enviar, la edición se funde en el alta pendiente (una sola operación)', async () => {
    const db = await seed();
    const p = createProductLocal(db, base, { today: TODAY });
    updateProductLocal(db, p.id, { ...base, name: 'Bujía NGK Iridium', brand: 'NGK Iridium', locationId: null }, { today: TODAY });
    const ops = db.select().from(outbox).all();
    expect(ops).toHaveLength(1); expect(ops[0].action).toBe('create');
    expect(JSON.parse(ops[0].payloadJson)).toMatchObject({ sku: 'MOV-001', name: 'Bujía NGK Iridium', brand: 'NGK Iridium', locationId: null });
    expect(getProductForEdit(db, p.id, TODAY)).toMatchObject({ name: 'Bujía NGK Iridium', brand: 'NGK Iridium', locationId: null, price: '12.5', isLocal: true });
  });

  it('producto del servidor: la edición va como update con la versión vista, sin sku; el precio nuevo queda visible', async () => {
    const db = await seed();
    await new SqlitePullStore(db).applyPage(page('products', [{ id: 'p9', sku: 'B-1', name: 'Batería', categoryId: 'k1', unitId: 'u1', unitCode: 'UND', taxId: 't16', version: 4, refs: [], barcodes: ['111'] }]), 'c');
    updateProductLocal(db, 'p9', { name: 'Batería 22MR', unitId: 'u1', taxId: 't16', brand: 'KTO', locationId: 'l2', price: '80', barcodes: ['111'] }, { today: TODAY });
    const op = db.select().from(outbox).get()!;
    expect(op).toMatchObject({ entity: 'product', action: 'update', entityId: 'p9' });
    const payload = JSON.parse(op.payloadJson);
    expect(payload).toMatchObject({ name: 'Batería 22MR', brand: 'KTO', locationId: 'l2', price: '80', version: 4, barcodes: ['111'] });
    expect(payload).not.toHaveProperty('sku');
    expect(searchProducts(db, { query: 'B-1', today: TODAY })[0]).toMatchObject({ price: '80', brand: 'KTO' });
    expect(() => updateProductLocal(db, 'nope', { name: 'x', unitId: 'u1' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    db.update(products).set({ trackingMode: 'SERIAL' }).where(eq(products.id, 'p9')).run();
    expect(() => updateProductLocal(db, 'p9', { name: 'x', unitId: 'u1' })).toThrow(expect.objectContaining({ code: 'NOT_EDITABLE' }));
  });

  it('alta rechazada: al corregirla se reenvía como alta NUEVA', async () => {
    const db = await seed();
    const p = createProductLocal(db, base, { today: TODAY });
    setOutcome(db, db.select().from(outbox).get()!.clientOpId, { status: 'REJECTED', error: 'LOCATION_NOT_FOUND: x' });
    updateProductLocal(db, p.id, { ...base, locationId: null }, { today: TODAY });
    expect(db.select().from(outbox).all().map((o) => `${o.action}:${o.status}`)).toEqual(['create:REJECTED', 'create:PENDING']);
  });

  it('los errores del contrato se explican en español con qué hacer', () => {
    expect(explainError('VERSION_CONFLICT: x')).toMatch(/Sincronice/);
    expect(explainError('LOCATION_NOT_FOUND: x')).toMatch(/ubicación/);
    expect(explainError('FORBIDDEN: sin permiso')).toMatch(/permiso/);
  });
});

describe('remapProduct y réplica', () => {
  it('el id del servidor reemplaza al local (códigos incluidos) y el precio provisional se retira; si ya bajó por el pull, se conserva el del servidor', async () => {
    const db = await seed();
    const p = createProductLocal(db, base, { today: TODAY });
    remapProduct(db, p.id, 'srv-9');
    expect(db.select().from(products).where(eq(products.sku, 'MOV-001')).get()).toMatchObject({ id: 'srv-9', isLocal: false });
    expect(db.select().from(productRefs).where(eq(productRefs.productId, 'srv-9')).all()).toHaveLength(2);
    expect(db.select().from(productPrices).where(eq(productPrices.productId, 'srv-9')).all()).toHaveLength(0);
    const q = createProductLocal(db, { ...base, sku: 'MOV-002', barcodes: [] }, { today: TODAY });
    await new SqlitePullStore(db).applyPage(page('products', [{ id: 'srv-10', sku: 'MOV-002', name: 'Bajó primero', unitId: 'u1', version: 1, refs: [], barcodes: [] }]), 'c');
    remapProduct(db, q.id, 'srv-10');
    expect(db.select().from(products).where(eq(products.sku, 'MOV-002')).all().map((r) => r.id)).toEqual(['srv-10']);
  });

  it('restablecer la réplica conserva los productos creados en el teléfono (con códigos y precio) y borra el resto', async () => {
    const db = await seed();
    const p = createProductLocal(db, base, { today: TODAY });
    wipeReplica(db);
    expect(db.select().from(products).all().map((r) => r.id)).toEqual([p.id]);
    expect(db.select().from(productRefs).all()).toHaveLength(2); expect(db.select().from(productPrices).all()).toHaveLength(1);
    expect(db.select().from(outbox).all()).toHaveLength(1);
  });
});

describe('envío por el motor de sincronización', () => {
  function engineFor(db: Awaited<ReturnType<typeof seed>>, over: (op: PushOperation) => Partial<OpResult> | undefined = () => undefined) {
    const requests: PushOperation[] = []; let n = 0;
    const f = fakeFetch({
      'POST /sync/push': ((_u: URL, init: RequestInit) => {
        const ops: PushOperation[] = JSON.parse(String(init.body)).operations; requests.push(...ops);
        return { body: { data: { results: ops.map((o) => ({ clientOpId: o.clientOpId, status: 'APPLIED', serverId: `srv-${++n}`, serverNumber: 'X', serverStatus: 'ACTIVE', ...over(o) })), serverTime: 'x' } } };
      }) as never,
      'GET /sync/pull': (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: false, serverTime: 'x' } } }),
    });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1.0.0', tokens: memoryTokens(), fetchImpl: f.impl });
    return { engine: new SyncEngine({ api, db, handlers: defaultHandlers, random: () => 0.5 }), requests };
  }

  it('product.create viaja con el contrato y el producto adopta el id del servidor; al editar de nuevo va como update', async () => {
    const db = await seed(); const t = engineFor(db);
    const p = createProductLocal(db, base, { today: TODAY });
    const r = await t.engine.run({ pull: false });
    expect(r).toMatchObject({ pushed: 1, applied: 1, rejected: 0 });
    expect(t.requests[0]).toMatchObject({ entity: 'product', action: 'create', entityId: p.id, data: { sku: 'MOV-001', brand: 'NGK', locationId: 'l1', price: '12.5' } });
    expect(db.select().from(products).where(eq(products.sku, 'MOV-001')).get()).toMatchObject({ id: 'srv-1', isLocal: false });
    updateProductLocal(db, 'srv-1', { ...base, name: 'Nuevo nombre' }, { today: TODAY });
    await t.engine.run({ pull: false });
    expect(t.requests[1]).toMatchObject({ entity: 'product', action: 'update', entityId: 'srv-1', data: { name: 'Nuevo nombre', version: 1 } });
    expect(t.requests[1].data).not.toHaveProperty('sku');
  });

  it('rechazo definitivo (VALIDATION_ERROR): queda REJECTED con su explicación y el producto local no se pierde', async () => {
    const db = await seed(); const t = engineFor(db, () => ({ status: 'REJECTED', serverId: undefined, errorCode: 'LOCATION_NOT_FOUND', message: 'locationId no existe' }));
    const p = createProductLocal(db, base, { today: TODAY });
    const r = await t.engine.run({ pull: false });
    expect(r).toMatchObject({ rejected: 1, applied: 0 });
    expect(db.select().from(outbox).get()).toMatchObject({ status: 'REJECTED', lastError: 'LOCATION_NOT_FOUND: locationId no existe' });
    expect(db.select().from(products).where(eq(products.id, p.id)).get()).toMatchObject({ isLocal: true });
    // corregir y reenviar
    updateProductLocal(db, p.id, { ...base, locationId: null }, { today: TODAY });
    expect(db.select().from(outbox).all().map((o) => o.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('SKU ya existente en el servidor: se vincula (linked) y el producto local desaparece a favor del del servidor', async () => {
    const db = await seed(); const t = engineFor(db, () => ({ serverId: 'p1', linked: true }));
    createProductLocal(db, { ...base, sku: 'EXISTE-EN-OFICINA' });
    await t.engine.run({ pull: false });
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()).toBeDefined();
    expect(db.select().from(products).where(eq(products.sku, 'EXISTE-EN-OFICINA')).all()).toHaveLength(0);
  });
});
