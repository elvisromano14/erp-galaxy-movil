import { count } from 'drizzle-orm';
import { ApiClient } from '../src/core/api/ApiClient';
import type { PullEntity } from '../src/core/api/contract';
import { AuthService, type DeviceStore } from '../src/core/auth/AuthService';
import { PinLock } from '../src/core/auth/PinLock';
import { SessionService } from '../src/core/session/SessionService';
import { defaultHandlers } from '../src/sync/handlers';
import { SyncEngine } from '../src/sync/SyncEngine';
import { versionLt } from '../src/core/version';
import { META, getMeta } from '../src/db/meta';
import { outbox, products } from '../src/db/schema';
import { fakeFetch, memoryPin, memoryTokens, nodeHasher } from './helpers';
import { createTestDb } from './testDb';

const memoryDevice = (): DeviceStore => { let key: string | null = null, id: string | null = null; return { getKey: async () => key, saveKey: async (k) => { key = k; }, getDeviceId: async () => id, saveDeviceId: async (i) => { id = i; }, clear: async () => { id = null; } }; };

/** Servidor simulado: login, dispositivo, perfil y sync/pull paginado (3 productos, páginas de 2). */
function server(opts: { minAppVersion?: string; companies?: number; failPullAfter?: number; revoked?: boolean } = {}) {
  const state = { pulls: [] as Record<string, string>[], failAfter: opts.failPullAfter ?? Infinity, revoked: opts.revoked ?? false, configDown: false };
  const company = (n: number) => ({ id: `c${n}`, rif: `J-0000000${n}-0`, legalName: `Empresa ${n}`, tradeName: null });
  const routes = {
    'GET /app/config': () => (state.configDown ? { status: 503, body: {} } : { body: { data: { minAppVersion: opts.minAppVersion ?? '1.0.0', latestAppVersion: '1.0.0', schemaVersion: 1, maintenance: null, serverTime: 'x' } } }),
    'POST /auth/login': () => ({ body: { data: { user: { id: 'u1', email: 'v@x.test', fullName: 'Vendedor', isSuperAdmin: false }, companies: Array.from({ length: opts.companies ?? 1 }, (_, i) => company(i + 1)),
      companyId: (opts.companies ?? 1) === 1 ? 'c1' : null, requiresCompanySelection: (opts.companies ?? 1) !== 1, accessToken: 'acc', refreshToken: 'ref' } } }),
    'POST /auth/select-company': (_u: URL, init: RequestInit) => ({ body: { data: { companyId: JSON.parse(String(init.body)).companyId, accessToken: 'acc2', refreshToken: 'ref2' } } }),
    'POST /devices/register': () => ({ status: 201, body: { data: { id: 'dev1', deviceCode: 'D01', name: 'Pixel', platform: 'android', appVersion: '1.0.0' } } }),
    'GET /auth/me': () => ({ body: { data: { user: { id: 'u1', email: 'v@x.test', fullName: 'Vendedor', isSuperAdmin: false }, company: company(1), permissions: ['sales:quotes:create', 'inventory:stock:read'], roles: [{ code: 'VENDEDOR', name: 'Vendedor' }] } } }),
    'POST /auth/refresh': () => ({ body: { data: { accessToken: 'acc3', refreshToken: 'ref3' } } }),
    'POST /auth/logout': { status: 204 },
    'POST /sync/push': (_u: URL, init: RequestInit) => {
      if (state.revoked) return { status: 403, body: { error: 'DEVICE_REVOKED', message: 'Revocado' } };
      const ops: { clientOpId: string }[] = JSON.parse(String(init.body)).operations;
      return { body: { data: { results: ops.map((o, i) => ({ clientOpId: o.clientOpId, status: 'APPLIED', serverId: `srv-${i}` })), serverTime: 'x' } } };
    },
    'GET /sync/pull': (u: URL) => {
      const q = Object.fromEntries(u.searchParams) as Record<string, string>; state.pulls.push(q);
      if (state.revoked) return { status: 403, body: { error: 'DEVICE_REVOKED', message: 'Revocado' } };
      if (state.pulls.length > state.failAfter) return { status: 503, body: { error: 'X' } };
      const entity = q.entity as PullEntity;
      const base = { entity, nextCursor: null as string | null, hasMore: false, fullRefresh: true, serverTime: 'x' };
      if (entity === 'products') {
        const all = [1, 2, 3].map((n) => ({ id: `p${n}`, sku: `S${n}`, name: `Producto ${n}`, isActive: true, version: 1, refs: [], barcodes: [] }));
        const from = q.cursor ? Number(q.cursor) : 0; const items = all.slice(from, from + 2);
        return { body: { data: { ...base, fullRefresh: false, items, nextCursor: String(from + items.length), hasMore: from + items.length < all.length } } };
      }
      if (entity === 'app_settings') return { body: { data: { ...base, items: [{ company: { id: 'c1' }, seller: { id: 's1' }, maxDiscountPct: '10' }] } } };
      return { body: { data: { ...base, fullRefresh: entity !== 'customers' && entity !== 'product_prices' && entity !== 'stock_snapshots' && entity !== 'my_documents', items: [] } } };
    },
  };
  return { routes, state };
}

function setup(srv = server(), extra: { now?: () => number; lockTimeoutMs?: number; tokens?: ReturnType<typeof memoryTokens> } = {}) {
  const f = fakeFetch(srv.routes as never);
  const tokens = extra.tokens ?? memoryTokens();
  const { db } = createTestDb();
  let session!: SessionService;
  let auth!: AuthService;
  const api: ApiClient = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1.0.0', tokens, fetchImpl: f.impl, getDeviceId: () => auth.deviceId, onSessionExpired: () => session.onSessionExpired() });
  auth = new AuthService(api, tokens, memoryDevice(), { deviceName: 'Pixel', newDeviceKey: () => 'k'.repeat(24), appVersion: '1.0.0' });
  const pinStore = memoryPin(); const pin = new PinLock(pinStore, nodeHasher);
  const bio = { available: true, ok: true, isAvailable: async () => bio.available, authenticate: async () => bio.ok };
  session = new SessionService({ api, auth, tokens, db, pin, biometric: bio, engine: new SyncEngine({ api, db, handlers: defaultHandlers }), appVersion: '1.0.0', versionLt, now: extra.now, lockTimeoutMs: extra.lockTimeoutMs });
  return { session, db, api, tokens, f, pin, pinStore, bio, srv };
}

/** Recorre el alta completa hasta quedar listo. */
async function fullSetup(t: ReturnType<typeof setup>) {
  await t.session.start(); await t.session.login('v@x.test', 'secreto'); await t.session.setPin('1234'); await t.session.bootstrap();
}

describe('SessionService', () => {
  it('sin sesión → anónimo; el alta completa llega a «listo» y guarda permisos y dispositivo localmente', async () => {
    const t = setup();
    await t.session.start(); expect(t.session.state.status).toBe('anonymous');
    await t.session.login('v@x.test', 'secreto');
    expect(t.session.state).toMatchObject({ status: 'needs-pin', deviceCode: 'D01', permissions: ['sales:quotes:create', 'inventory:stock:read'] });
    await t.session.setPin('1234'); expect(t.session.state.status).toBe('needs-bootstrap');
    await t.session.bootstrap();
    expect(t.session.state).toMatchObject({ status: 'ready', bootstrap: null });
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(3);
    expect(getMeta(t.db, META.bootstrapDoneAt)).not.toBeNull(); expect(getMeta(t.db, META.companyId)).toBe('c1');
  });

  it('con varias empresas pide elegir; el nuevo refresh token reemplaza al anterior', async () => {
    const t = setup(server({ companies: 2 }));
    await t.session.start(); await t.session.login('v@x.test', 'x');
    expect(t.session.state).toMatchObject({ status: 'needs-company' }); expect(t.session.state.companies).toHaveLength(2);
    await t.session.chooseCompany('c1');
    expect(t.session.state.status).toBe('needs-pin'); expect(t.tokens.refresh).toBe('ref2');
  });

  it('reinicio de la app: pide el PIN (bloqueado) y al desbloquear abre sin repetir la descarga', async () => {
    const t = setup(); await fullSetup(t);
    const again = new SessionService({ ...(t.session as any).d }); // «reinicio»: mismo teléfono, nuevo proceso
    await again.start();
    expect(again.state.status).toBe('locked'); expect(again.state.permissions).toContain('sales:quotes:create');
    await again.unlock('1234'); expect(again.state.status).toBe('ready');
  });

  it('PIN incorrecto cuenta intentos; el 5.º cierra la sesión pero CONSERVA la cola de salida', async () => {
    const t = setup(); await fullSetup(t); t.session.lock();
    t.db.insert(outbox).values({ clientOpId: 'op1', clientSeq: 1, entity: 'sales_order', action: 'create', entityId: 'x', payloadJson: '{}', createdAt: 'now' }).run();
    await t.session.unlock('0000'); expect(t.session.state.error).toContain('4 intentos');
    for (let i = 0; i < 4; i++) await t.session.unlock('0000');
    expect(t.session.state.status).toBe('anonymous'); expect(t.tokens.refresh).toBeNull(); expect(t.pinStore.rec).toBeNull();
    expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(1);
  });

  it('huella: desbloquea si el teléfono la tiene y la persona se autentica', async () => {
    const t = setup(); await fullSetup(t); t.session.lock();
    t.bio.ok = false; await t.session.unlockWithBiometric(); expect(t.session.state.status).toBe('locked');
    t.bio.ok = true; await t.session.unlockWithBiometric(); expect(t.session.state.status).toBe('ready');
  });

  it('bloqueo por inactividad: tras el tiempo en segundo plano pide PIN; antes no', async () => {
    let now = 1_000_000;
    const t = setup(server(), { now: () => now, lockTimeoutMs: 60_000 }); await fullSetup(t);
    t.session.onBackground(); now += 30_000; t.session.onForeground(); expect(t.session.state.status).toBe('ready');
    t.session.onBackground(); now += 61_000; t.session.onForeground(); expect(t.session.state.status).toBe('locked');
  });

  it('versión obsoleta → bloqueada (sin tocar la cola)', async () => {
    const t = setup(server({ minAppVersion: '2.0.0' })); await t.session.start();
    expect(t.session.state).toMatchObject({ status: 'blocked', blocked: { reason: 'UPGRADE_REQUIRED' } });
  });

  it('sin red al arrancar NO bloquea: abre con PIN y trabaja con los datos locales', async () => {
    const t = setup(); await fullSetup(t);
    t.srv.state.configDown = true;
    const again = new SessionService({ ...(t.session as any).d }); await again.start();
    expect(again.state).toMatchObject({ status: 'locked', online: false });
  });

  it('descarga reanudable: un corte a mitad conserva el cursor y al reintentar continúa donde quedó', async () => {
    const srv = server({ failPullAfter: 7 }); // app_settings…customers (5) + 1.ª página de productos (6) + 2.ª (7) → falla en la 8.ª llamada
    const t = setup(srv); await t.session.start(); await t.session.login('v@x.test', 'x'); await t.session.setPin('1234');
    srv.state.failAfter = 8; // 7 entidades previas + 1.ª página de productos; la siguiente llamada falla
    await t.session.bootstrap();
    expect(t.session.state).toMatchObject({ status: 'needs-bootstrap', online: false }); expect(t.session.state.error).toContain('Sin conexión');
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(2);
    expect(getMeta(t.db, META.cursor('products'))).toBe('2');
    srv.state.failAfter = Infinity; srv.state.pulls.length = 0;
    await t.session.bootstrap();
    expect(t.session.state.status).toBe('ready'); expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(3);
    const productPulls = srv.state.pulls.filter((q) => q.entity === 'products');
    expect(productPulls[0].cursor).toBe('2'); // continuó desde el cursor, no desde cero
  });

  it('la descarga se puede cancelar y retomar', async () => {
    const t = setup(); await t.session.start(); await t.session.login('v@x.test', 'x'); await t.session.setPin('1234');
    const stop = t.session.store.subscribe((s) => { if (s.bootstrap && s.bootstrap.index >= 2) t.session.cancelBootstrap(); });
    await t.session.bootstrap(); stop();
    expect(t.session.state.error).toContain('cancelada'); expect(t.session.state.status).toBe('needs-bootstrap');
    await t.session.bootstrap(); expect(t.session.state.status).toBe('ready');
  });

  it('dispositivo revocado durante una sincronización: bloquea, borra la réplica y conserva el outbox', async () => {
    const t = setup(); await fullSetup(t);
    t.db.insert(outbox).values({ clientOpId: 'op1', clientSeq: 1, entity: 'customer', action: 'create', entityId: 'x', payloadJson: '{}', createdAt: 'now' }).run();
    t.srv.state.revoked = true;
    await t.session.sync();
    expect(t.session.state).toMatchObject({ status: 'blocked', blocked: { reason: 'DEVICE_REVOKED' } });
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(0); expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(1);
  });

  it('sesión vencida (refresh rechazado) → pide login de nuevo sin perder datos locales', async () => {
    const t = setup(); await fullSetup(t);
    (t.f as any).calls.length = 0;
    t.srv.routes['GET /sync/pull'] = () => ({ status: 401, body: {} }) as never;
    t.srv.routes['POST /auth/refresh'] = () => ({ status: 401, body: { error: 'REFRESH_INVALID' } }) as never;
    await t.session.sync();
    expect(t.session.state.status).toBe('anonymous'); expect(t.session.state.error).toContain('Sus pendientes se conservan');
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(3);
  });

  it('otra empresa en el mismo teléfono: con pendientes de la anterior NO se mezcla; sin pendientes se limpia la réplica', async () => {
    const t = setup(); await fullSetup(t);
    t.db.insert(outbox).values({ clientOpId: 'op1', clientSeq: 1, entity: 'customer', action: 'create', entityId: 'x', payloadJson: '{}', createdAt: 'now' }).run();
    await t.session.logout();
    t.srv.routes['GET /auth/me'] = () => ({ body: { data: { user: { id: 'u2' }, company: { id: 'c9', rif: 'J-1', legalName: 'Otra', tradeName: null }, permissions: [], roles: [] } } }) as never;
    await t.session.login('otro@x.test', 'x');
    expect(t.session.state.error).toContain('pendientes de otra empresa');
    t.db.delete(outbox).run();
    await t.session.login('otro@x.test', 'x');
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(0); expect(getMeta(t.db, META.companyId)).toBe('c9');
  });
});
