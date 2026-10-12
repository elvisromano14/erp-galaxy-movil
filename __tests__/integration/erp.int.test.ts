/**
 * Prueba de integración contra la API REAL del ERP (no un simulador). Se activa con ERP_E2E_URL, por ejemplo:
 *   ERP_E2E_URL=http://127.0.0.1:3101 ERP_E2E_SUPER_EMAIL=superadmin@erp.local ERP_E2E_SUPER_PASSWORD='Admin12345!' pnpm test:int
 * Crea su propia empresa de prueba y recorre: login → empresa → dispositivo → PIN → descarga inicial → sincronización → revocación.
 */
import { count } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../../src/core/api/ApiClient';
import { AuthService, type DeviceStore } from '../../src/core/auth/AuthService';
import { PinLock } from '../../src/core/auth/PinLock';
import { SessionService } from '../../src/core/session/SessionService';
import { defaultHandlers } from '../../src/sync/handlers';
import { SyncEngine } from '../../src/sync/SyncEngine';
import { versionLt } from '../../src/core/version';
import { defaultCurrency, findByCode, getProductDetail, searchProducts } from '../../src/db/repositories/products';
import { fetchLiveStock } from '../../src/features/products/liveStock';
import { caracasToday } from '../../src/core/format';
import { createCustomerLocal, updateCustomerLocal } from '../../src/db/repositories/customers';
import { getDocument, saveDraft, submitDocument } from '../../src/db/repositories/documents';
import { computeTotals } from '../../src/features/documents/calc';
import { priceListFor, priceOf, productForLine } from '../../src/features/documents/pricing';
import { outbox } from '../../src/db/schema';
import { salesDocuments } from '../../src/db/schema';
import { customers, productPrices, productRefs, products, stockSnapshots, taxes, warehouses } from '../../src/db/schema';
import { META, getJson, getMeta } from '../../src/db/meta';
import { memoryPin, memoryTokens, nodeHasher } from '../helpers';
import { createTestDb } from '../testDb';

const URL_ = process.env.ERP_E2E_URL;
const run = URL_ ? describe : describe.skip;

/** Red con fallos programables: `loseNext` descarta la respuesta de los próximos push (el servidor SÍ los procesó). */
const net = { loseNext: 0 };
const flaky: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (String(input).includes('/sync/push') && net.loseNext > 0) { net.loseNext--; throw new TypeError('Network request failed'); }
  return res;
};

const memoryDevice = (): DeviceStore => { let key: string | null = null, id: string | null = null; return { getKey: async () => key, saveKey: async (k) => { key = k; }, getDeviceId: async () => id, saveDeviceId: async (i) => { id = i; }, clear: async () => { id = null; } }; };

/** Cliente HTTP mínimo para preparar datos como administrador. */
async function admin(token: string | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${URL_}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json.data;
}

run('Integración con el ERP real', () => {
  jest.setTimeout(60_000);
  const rnd = Math.random().toString(36).slice(2, 8);
  const vendor = { email: `movil-${rnd}@test.local`, password: 'Movil12345!' };
  let adminToken: string; let companyId: string; let sellerId: string; let deviceId: string; let first: ReturnType<typeof mobile>;

  beforeAll(async () => {
    const login = await admin(null, 'POST', '/auth/login', { email: process.env.ERP_E2E_SUPER_EMAIL ?? 'superadmin@erp.local', password: process.env.ERP_E2E_SUPER_PASSWORD ?? 'Admin12345!' });
    // RIF válido: se prueba con números hasta dar con el dígito verificador correcto
    const { isValidRif } = require('../../src/vendor/erp-domain');
    let rif = ''; for (let n = 10_000_000 + Math.floor(Math.random() * 80_000_000); !rif; n++) for (let d = 0; d < 10 && !rif; d++) if (isValidRif(`J${n}${d}`)) rif = `J-${n}-${d}`;
    const company = await admin(login.accessToken, 'POST', '/companies', { rif, legalName: `Empresa Móvil ${rnd}`, fiscalAddress: 'Caracas, prueba de integración' });
    companyId = company.id;
    adminToken = (await admin(login.accessToken, 'POST', '/auth/select-company', { companyId })).accessToken;

    // catálogo mínimo con existencias, lista de precios y un vendedor ligado a un usuario
    const units = (await admin(adminToken, 'GET', '/units?limit=100')); const unitId = units.find((u: any) => u.code === 'UND').id;
    const wh = (await admin(adminToken, 'GET', '/warehouses'))[0].id;
    const iva = (await admin(adminToken, 'GET', '/taxes?limit=100')).find((t: any) => t.code === 'IVA_GENERAL').id;
    const usd = (await admin(adminToken, 'GET', '/currencies?limit=10')).find((c: any) => c.code === 'USD').id;
    const list = await admin(adminToken, 'POST', '/price-lists', { code: 'MAY', name: 'Mayorista', currencyId: usd, isDefault: true });
    for (const [sku, price] of [['INT-001', '20'], ['INT-002', '10']] as const) {
      const p = await admin(adminToken, 'POST', '/products', { sku, name: `Producto ${sku}`, unitId, taxId: iva, barcodes: [`7501${sku.slice(-3)}`], references: [{ refType: 'OEM', code: `OEM-${sku}` }] });
      const ch = await admin(adminToken, 'POST', '/inventory/charges', { warehouseId: wh, lines: [{ productId: p.id, quantity: '10', unitCost: '5' }] });
      await admin(adminToken, 'POST', `/inventory/charges/${ch.id}/confirm`);
      await admin(adminToken, 'POST', `/products/${p.id}/prices`, { priceListId: list.id, price });
    }
    const user = await admin(adminToken, 'POST', '/users', { email: vendor.email, fullName: 'Vendedor Integración', password: vendor.password, roleCodes: ['VENDEDOR'] });
    sellerId = (await admin(adminToken, 'POST', '/sellers', { code: 'V01', name: 'Vendedor Integración', userId: user.id, maxDiscountPct: '10' })).id;
    const crif = `V-${19_000_000 + Math.floor(Math.random() * 999_999)}-0`;
    await admin(adminToken, 'POST', '/customers', { rif: (() => { for (let n = 19_000_000 + Math.floor(Math.random() * 900_000); ; n++) for (let d = 0; d < 10; d++) if (isValidRif(`V${n}${d}`)) return `V-${n}-${d}`; })(), legalName: 'Cliente de integración', sellerId, creditDays: 15 });
    void crif;
  });

  function mobile() {
    const tokens = memoryTokens(); const { db } = createTestDb();
    let session!: SessionService; let auth!: AuthService;
    const api: ApiClient = new ApiClient({ baseUrl: URL_!, appVersion: '1.0.0', tokens, fetchImpl: flaky, getDeviceId: () => auth.deviceId, onSessionExpired: () => session.onSessionExpired() });
    auth = new AuthService(api, tokens, memoryDevice(), { deviceName: 'Pixel de integración', newDeviceKey: () => randomUUID(), appVersion: '1.0.0' });
    const bio = { isAvailable: async () => false, authenticate: async () => false };
    const engine = new SyncEngine({ api, db, handlers: defaultHandlers });
    session = new SessionService({ api, auth, tokens, db, pin: new PinLock(memoryPin(), nodeHasher), biometric: bio, engine, appVersion: '1.0.0', versionLt });
    return { session, db, auth, api, engine: session['d'].engine as SyncEngine };
  }

  it('login → dispositivo → PIN → descarga inicial real: el catálogo queda en SQLite', async () => {
    const m = mobile(); first = m;
    await m.session.start();
    await m.session.login(vendor.email, vendor.password);
    expect(m.session.state).toMatchObject({ status: 'needs-pin', deviceCode: expect.stringMatching(/^D\d{2}$/) });
    expect(m.session.state.permissions).toEqual(expect.arrayContaining(['mobile:sync:use', 'sales:quotes:create']));
    deviceId = m.auth.deviceId!;
    await m.session.setPin('1234');
    await m.session.bootstrap();
    expect(m.session.state).toMatchObject({ status: 'ready', error: null });

    const n = (t: any) => (m.db.select({ n: count() }).from(t).get() as { n: number }).n;
    expect(n(products)).toBe(2); expect(n(productPrices)).toBe(2); expect(n(stockSnapshots)).toBe(2);
    expect(n(customers)).toBe(1); expect(n(warehouses)).toBeGreaterThanOrEqual(1); expect(n(taxes)).toBeGreaterThanOrEqual(3);
    expect(n(productRefs)).toBe(4); // 2 OEM + 2 códigos de barras
    const prod = m.db.select().from(products).all().find((p) => p.sku === 'INT-001')!;
    expect(prod.searchText).toContain('oem-int-001');
    expect(m.db.select().from(customers).get()).toMatchObject({ legalName: 'Cliente de integración', validationStatus: 'VALIDATED', creditDays: 15 });
    // ajustes y políticas del vendedor
    const settings = getJson<any>(m.db, 'seller'); expect(settings).toMatchObject({ code: 'V01' });
    expect(getMeta(m.db, META.companyId)).toBe(companyId); expect(getMeta(m.db, META.bootstrapDoneAt)).not.toBeNull();

    // M2: búsqueda local, precios con moneda y existencia en vivo (sin costos) contra el servidor real
    const today = caracasToday();
    const hits = searchProducts(m.db, { query: 'oem-int-001', today });
    expect(hits).toHaveLength(1); expect(hits[0]).toMatchObject({ sku: 'INT-001', price: '20', available: 10 });
    expect(findByCode(m.db, '7501001')?.sku).toBe('INT-001'); // código de barras
    expect(defaultCurrency(m.db)).toMatchObject({ code: 'USD', symbol: '$' });
    const detail = getProductDetail(m.db, hits[0].id, today)!;
    expect(detail.prices[0]).toMatchObject({ listCode: 'MAY', currencyCode: 'USD', price: '20' });
    expect(detail.tax).toMatchObject({ rate: '16' }); expect(detail.stock[0]).toMatchObject({ quantity: '10', reserved: '0' });
    const live = await fetchLiveStock(m.api, hits[0].id);
    expect(live.warehouses[0]).toMatchObject({ quantity: '10', available: '10' });
    expect(JSON.stringify(live)).not.toMatch(/cost/i);

    // sincronización incremental sin cambios: no baja nada nuevo; con un cambio en el servidor, lo trae
    const before = n(products);
    await m.session.sync(); expect(n(products)).toBe(before);
    const created = await admin(adminToken, 'POST', '/products', { sku: 'INT-003', name: 'Producto nuevo', unitId: (await admin(adminToken, 'GET', '/units?limit=100')).find((u: any) => u.code === 'UND').id });
    await m.session.sync();
    expect(n(products)).toBe(before + 1); expect(m.db.select().from(products).all().some((p) => p.id === created.id)).toBe(true);
  });

  /** RIF válido y único para pruebas. */
  const newRif = (() => { let n = 20_000_000 + Math.floor(Math.random() * 5_000_000); const { isValidRif } = require('../../src/vendor/erp-domain'); return () => { for (;;) { n++; for (let d = 0; d < 10; d++) if (isValidRif(`V${n}${d}`)) return `V-${n}-${d}`; } }; })();
  const serverCustomers = async (search: string) => (await admin(adminToken, 'GET', `/customers?search=${encodeURIComponent(search)}&limit=100`)) as any[];

  it('M3: 10 clientes sin conexión; un corte pierde la respuesta; al reintentar quedan EXACTAMENTE 10 (sin duplicados), con vínculo por RIF y rechazo por política', async () => {
    const m = first; const tag = `M3 Cliente ${rnd}`;
    for (let i = 1; i <= 10; i++) createCustomerLocal(m.db, { rif: newRif(), legalName: `${tag} ${i}`, phone: '0412-0000000' });
    expect((await serverCustomers(tag))).toHaveLength(0); // aún nada en el servidor

    net.loseNext = 1; // el servidor procesa el lote pero el teléfono no ve la respuesta
    expect((await m.engine.run()).offline).toBe(true);
    expect(await serverCustomers(tag)).toHaveLength(10);
    expect(m.db.select().from(customers).all().filter((c) => c.isLocal)).toHaveLength(10); // el teléfono aún no lo sabe

    m.db.update(outbox).set({ nextAttemptAt: null }).run(); // «pasó la espera»
    const r = await m.engine.run();
    expect(r).toMatchObject({ applied: 10, offline: false });
    const server = await serverCustomers(tag);
    expect(server).toHaveLength(10); // reintentar NO duplicó
    expect(server.every((c: any) => c.validationStatus === 'PENDING' && c.sellerId === sellerId)).toBe(true);
    expect(m.db.select().from(customers).all().filter((c) => c.isLocal)).toHaveLength(0);
    expect(new Set(m.db.select().from(customers).all().filter((c) => c.legalName.startsWith(tag)).map((c) => c.id))).toEqual(new Set(server.map((c: any) => c.id)));
    expect(m.session.state.queue).toBeDefined();

    // un cliente que ya existe en el servidor (fuera de mi cartera): se VINCULA por RIF, no se duplica
    const sharedRif = newRif();
    const existing = await admin(adminToken, 'POST', '/customers', { rif: sharedRif, legalName: `${tag} Existente`, creditDays: 0 });
    const local = createCustomerLocal(m.db, { rif: sharedRif, legalName: `${tag} Existente (mi captura)` });
    await m.engine.run();
    expect(m.db.select().from(customers).all().some((c) => c.id === local.id)).toBe(false);
    expect(m.db.select().from(customers).all().some((c) => c.id === existing.id)).toBe(true);
    expect((await serverCustomers(`${tag} Existente`))).toHaveLength(1);

    // el administrador le quita el permiso de crear clientes: el servidor rechaza con motivo; al volver a permitirlo, se corrige y se reenvía
    await admin(adminToken, 'PATCH', `/sellers/${sellerId}`, { allowCustomerCreate: false });
    const blockedRif = newRif();
    const rejected = createCustomerLocal(m.db, { rif: blockedRif, legalName: `${tag} Rechazado` });
    await m.engine.run();
    expect(m.db.select().from(outbox).all().find((o) => o.entityId === rejected.id)).toMatchObject({ status: 'REJECTED', lastError: expect.stringContaining('CUSTOMER_CREATE_NOT_ALLOWED') });
    expect(m.db.select().from(customers).all().find((c) => c.id === rejected.id)).toMatchObject({ isLocal: true });
    await admin(adminToken, 'PATCH', `/sellers/${sellerId}`, { allowCustomerCreate: true });
    updateCustomerLocal(m.db, rejected.id, { legalName: `${tag} Corregido` });
    await m.engine.run();
    expect(await serverCustomers(`${tag} Corregido`)).toHaveLength(1);
    expect(m.session.pendingCount()).toBe(0);
  });

  it('M4: cotización creada sin conexión con un cliente nuevo → se envía en orden; los totales locales COINCIDEN con los del servidor; número definitivo y refresco por pull', async () => {
    const m = first; const tag = `M4 ${rnd}`;
    const today = caracasToday();
    // cliente nuevo sin conexión + cotización que lo usa (el servidor resuelve el id local)
    const cust = createCustomerLocal(m.db, { rif: newRif(), legalName: `${tag} Cliente nuevo` });
    const list = priceListFor(m.db, cust.id)!;
    const prods = m.db.select().from(products).all().filter((p) => p.sku === 'INT-001' || p.sku === 'INT-002');
    const mk = (sku: string, qty: string, disc: string) => {
      const p = prods.find((x) => x.sku === sku)!; const info = productForLine(m.db, p.id)!;
      return { productId: p.id, sku: p.sku, description: null, quantity: qty, unitPrice: priceOf(m.db, p.id, list.id, today)!, discountPct: disc, taxId: info.taxId, taxRate: info.taxRate };
    };
    const lines = [mk('INT-001', '2', '5'), mk('INT-002', '3', '0')];
    const id = saveDraft(m.db, { docType: 'QUOTE', customerId: cust.id, currencyId: list.currencyId, paymentCondition: 'CASH', creditDays: 0, validUntil: '2026-12-31', notes: 'Cotización de integración', warehouseId: null, lines });
    submitDocument(m.db, id);
    const local = getDocument(m.db, id)!;
    expect(local.doc).toMatchObject({ localStatus: 'PENDING_SYNC', localNumber: expect.stringMatching(/^OFF-D\d{2}-\d{6}$/), total: '78.8800' });
    expect(computeTotals(lines.map((l) => ({ ...l, taxExempt: false }))).total).toBe('78.8800');

    const r = await m.engine.run();
    expect(r).toMatchObject({ rejected: 0, offline: false });
    const synced = getDocument(m.db, id)!;
    expect(synced.doc).toMatchObject({ localStatus: 'SYNCED', serverStatus: 'SENT', serverNumber: expect.stringMatching(/^COT-V-\d{6}$/) });
    expect(synced.displayNumber).toBe(synced.doc.serverNumber);
    // paridad de cálculo móvil/servidor (plan §16, riesgo 8)
    const server = await admin(adminToken, 'GET', `/sales/quotes/${synced.doc.serverId}`);
    expect(Number(server.subtotal)).toBe(Number(local.doc.subtotal)); expect(Number(server.taxTotal)).toBe(Number(local.doc.taxTotal)); expect(Number(server.total)).toBe(Number(local.doc.total));
    expect(server.sellerId).toBe(sellerId); expect(server.status).toBe('SENT');
    // el cliente nuevo ya está en el servidor y la cotización apunta a él
    const serverCustomer = (await serverCustomers(`${tag} Cliente nuevo`))[0];
    expect(server.customerId).toBe(serverCustomer.id);
    expect(m.db.select().from(customers).all().some((c) => c.id === serverCustomer.id && !c.isLocal)).toBe(true);
    expect(synced.doc.customerId).toBe(serverCustomer.id); // documentos locales re-apuntados al cliente del servidor
    // el pull de «mis documentos» no la pisa ni la duplica
    await m.engine.run();
    expect(m.db.select().from(salesDocuments).all().filter((d) => d.serverId === synced.doc.serverId)).toHaveLength(1);
  });

  it('un segundo teléfono del mismo vendedor es rechazado; al revocar el primero, este se bloquea y el segundo ya puede registrarse', async () => {
    const second = mobile();
    await second.session.start(); await second.session.login(vendor.email, vendor.password);
    expect(second.session.state.status).toBe('anonymous');
    expect(second.session.state.error).toContain('dispositivo activo');

    // el administrador revoca el primero: en su próxima sincronización queda bloqueado, sin réplica y con la cola intacta
    await admin(adminToken, 'POST', `/devices/${deviceId}/revoke`);
    await first.session.sync();
    expect(first.session.state).toMatchObject({ status: 'blocked', blocked: { reason: 'DEVICE_REVOKED' } });
    expect((first.db.select({ n: count() }).from(products).get() as { n: number }).n).toBe(0);

    // liberado el cupo, el vendedor registra su teléfono nuevo
    const replacement = mobile();
    await replacement.session.start(); await replacement.session.login(vendor.email, vendor.password);
    expect(replacement.session.state.status).toBe('needs-pin');
    expect(replacement.session.state.deviceCode).toMatch(/^D\d{2}$/);
    expect(replacement.auth.deviceId).not.toBe(deviceId);
  });
});
