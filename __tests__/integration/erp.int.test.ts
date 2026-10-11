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
import { versionLt } from '../../src/core/version';
import { customers, productPrices, productRefs, products, stockSnapshots, taxes, warehouses } from '../../src/db/schema';
import { META, getJson, getMeta } from '../../src/db/meta';
import { memoryPin, memoryTokens, nodeHasher } from '../helpers';
import { createTestDb } from '../testDb';

const URL_ = process.env.ERP_E2E_URL;
const run = URL_ ? describe : describe.skip;

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
    const api: ApiClient = new ApiClient({ baseUrl: URL_!, appVersion: '1.0.0', tokens, getDeviceId: () => auth.deviceId, onSessionExpired: () => session.onSessionExpired() });
    auth = new AuthService(api, tokens, memoryDevice(), { deviceName: 'Pixel de integración', newDeviceKey: () => randomUUID(), appVersion: '1.0.0' });
    const bio = { isAvailable: async () => false, authenticate: async () => false };
    session = new SessionService({ api, auth, tokens, db, pin: new PinLock(memoryPin(), nodeHasher), biometric: bio, appVersion: '1.0.0', versionLt });
    return { session, db, auth, api };
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

    // sincronización incremental sin cambios: no baja nada nuevo; con un cambio en el servidor, lo trae
    const before = n(products);
    await m.session.sync(); expect(n(products)).toBe(before);
    const created = await admin(adminToken, 'POST', '/products', { sku: 'INT-003', name: 'Producto nuevo', unitId: (await admin(adminToken, 'GET', '/units?limit=100')).find((u: any) => u.code === 'UND').id });
    await m.session.sync();
    expect(n(products)).toBe(before + 1); expect(m.db.select().from(products).all().some((p) => p.id === created.id)).toBe(true);
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
