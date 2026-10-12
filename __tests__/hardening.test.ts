import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ApiClient } from '../src/core/api/ApiClient';
import type { OpResult, PushOperation } from '../src/core/api/contract';
import { AuthService, type DeviceStore } from '../src/core/auth/AuthService';
import { PinLock } from '../src/core/auth/PinLock';
import { DAY_MS, POLICY } from '../src/core/config/policy';
import { SessionService } from '../src/core/session/SessionService';
import { clearLog, exportLog, getLog, logger, reportException, setErrorReporter } from '../src/core/telemetry/log';
import { scrub, scrubText } from '../src/core/telemetry/scrub';
import { versionLt } from '../src/core/version';
import { createCustomerLocal } from '../src/db/repositories/customers';
import { enqueue, MAX_RETRY_WAIT_MS, nextBatch, setOutcome } from '../src/db/repositories/outbox';
import { META, getMeta, setMeta } from '../src/db/meta';
import { getOrCreateDbKey, pragmaKey } from '../src/db/encryption';
import { customers, outbox, products, syncMeta } from '../src/db/schema';
import * as schema from '../src/db/schema';
import type { AppDb } from '../src/db/types';
import { collectDiagnostics } from '../src/features/diagnostics/collect';
import { runBackgroundSync } from '../src/sync/backgroundSync';
import { defaultHandlers } from '../src/sync/handlers';
import { SyncEngine } from '../src/sync/SyncEngine';
import { fakeFetch, memoryPin, memoryTokens, nodeHasher } from './helpers';
import { createTestDb } from './testDb';

const memoryDevice = (): DeviceStore => { let key: string | null = null, id: string | null = null; return { getKey: async () => key, saveKey: async (k) => { key = k; }, getDeviceId: async () => id, saveDeviceId: async (i) => { id = i; }, clear: async () => { id = null; } }; };
const rif = (n: number) => { const W = [4, 3, 2, 7, 6, 5, 4, 3, 2]; const d = String(n).padStart(8, '0'); const s = [1, ...d.split('').map(Number)].reduce((a, x, i) => a + x * W[i], 0); const c = 11 - (s % 11); return `V-${d}-${c >= 10 ? 0 : c}`; };

const pull = (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: true, serverTime: 'x' } } });

describe('telemetría sin datos personales', () => {
  it('enmascara correos, RIF, teléfonos y tokens; oculta claves sensibles', () => {
    expect(scrubText('Error con juan@correo.com y V-19322174-9 tel 0414-1234567 Bearer abc.def.ghi')).toBe('Error con [correo] y [rif] tel [teléfono] Bearer [token]');
    const s = scrub({ password: 'x', nested: { refreshToken: 'r', email: 'a@b.co', ok: 1 }, list: ['J-12345678-4'] }) as any;
    expect(s).toEqual({ password: '[oculto]', nested: { refreshToken: '[oculto]', email: '[correo]', ok: 1 }, list: ['[rif]'] });
  });
  it('el registro local depura lo que guarda, es un anillo y exporta texto; el reportero externo solo recibe contexto depurado', () => {
    clearLog();
    logger.info('t', 'Cliente V-19322174-9 creado', { token: 'secreto', n: 1 });
    expect(getLog()[0]).toMatchObject({ message: 'Cliente [rif] creado', data: { token: '[oculto]', n: 1 } });
    expect(exportLog()).toContain('INFO [t] Cliente [rif] creado');
    for (let i = 0; i < 400; i++) logger.info('x', String(i));
    expect(getLog().length).toBe(300);
    const seen: unknown[] = []; setErrorReporter((e, ctx) => seen.push([(e as Error).message, ctx]));
    reportException(new Error('falló para a@b.co'), { rif: 'V-19322174-9', password: 'p' });
    expect(seen[0]).toEqual(['falló para [correo]', { rif: '[rif]', password: '[oculto]' }]);
    setErrorReporter(() => { throw new Error('el reporte falla'); }); expect(() => reportException(new Error('x'))).not.toThrow(); setErrorReporter(null);
  });
});

describe('cifrado de la base (SQLCipher opcional)', () => {
  it('la clave se genera una vez, es aleatoria y se reutiliza; el PRAGMA solo admite hexadecimal', () => {
    let stored: string | null = null; let calls = 0;
    const store = { get: () => stored, set: (v: string) => { stored = v; } };
    const rnd = (n: number) => { calls++; return 'ab'.repeat(n); };
    const k1 = getOrCreateDbKey(store, rnd); const k2 = getOrCreateDbKey(store, rnd);
    expect(k1).toBe(k2); expect(calls).toBe(1); expect(k1).toHaveLength(64);
    expect(pragmaKey('ab12')).toBe("PRAGMA key = 'ab12';");
    expect(pragmaKey("ab'; DROP TABLE x;--")).toMatch(/^PRAGMA key = '[0-9a-fA-F]*';$/); // cualquier carácter no hexadecimal se descarta
    expect(pragmaKey("ab'; DROP TABLE x;--")).not.toContain("'; DROP");
  });
});

describe('reloj y reintentos', () => {
  it('si el reloj retrocedió (espera guardada absurdamente lejana) la operación se considera vencida', () => {
    const { db } = createTestDb();
    const a = enqueue(db, { entity: 'customer', action: 'create', entityId: 'e1', payload: {} });
    const b = enqueue(db, { entity: 'customer', action: 'create', entityId: 'e2', payload: {} });
    const now = Date.UTC(2026, 9, 11, 12);
    setOutcome(db, a.clientOpId, { status: 'PENDING', attempts: 1, nextAttemptAt: new Date(now + 10 * 60_000).toISOString() }); // espera normal: no vence
    setOutcome(db, b.clientOpId, { status: 'PENDING', attempts: 1, nextAttemptAt: new Date(now + MAX_RETRY_WAIT_MS + 3_600_000).toISOString() }); // reloj desfasado: vence
    expect(nextBatch(db, 10, new Date(now).toISOString()).map((o) => o.entityId)).toEqual(['e2']);
  });
});

describe('caos: cierre forzado y red intermitente', () => {
  it('un fallo a mitad del guardado no deja cliente sin operación ni al revés (transacción atómica)', () => {
    const { db } = createTestDb();
    createCustomerLocal(db, { rif: rif(1), legalName: 'Primero' });
    setMeta(db, META.localSeq, '0'); // fuerza colisión de secuencia con la operación existente → falla el INSERT del outbox
    expect(() => createCustomerLocal(db, { rif: rif(2), legalName: 'Segundo' })).toThrow();
    expect(db.select().from(customers).all().map((c) => c.legalName)).toEqual(['Primero']);
    expect(db.select({ n: count() }).from(outbox).get()!.n).toBe(1);
  });

  it('40 operaciones con red intermitente (503, respuestas perdidas, éxito) y reintentos: el servidor aplica cada una EXACTAMENTE una vez', async () => {
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const applied = new Map<string, OpResult>(); let n = 0;
    const f = fakeFetch({
      'POST /sync/push': (_u: URL, init: RequestInit) => {
        const r = rnd();
        if (r < 0.25) return { status: 503, body: { error: 'DOWN' } }; // cae antes de procesar
        const ops: PushOperation[] = JSON.parse(String(init.body)).operations;
        const results = ops.map((op) => { const prev = applied.get(op.clientOpId); if (prev) return { ...prev, status: 'DUPLICATE' as const }; const x: OpResult = { clientOpId: op.clientOpId, status: 'APPLIED', serverId: `s${++n}` }; applied.set(op.clientOpId, x); return x; });
        return { body: { data: { results, serverTime: 'x' } } };
      },
      'GET /sync/pull': (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: true, serverTime: 'x' } } }),
    });
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await f.impl(input, init);
      if (String(input).includes('/sync/push') && res.ok && rnd() < 0.3) throw new TypeError('Network request failed'); // procesó pero se perdió la respuesta
      return res;
    }) as typeof fetch;
    const { db } = createTestDb();
    let now = 1_000_000;
    const engine = new SyncEngine({ api: new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: impl }), db, handlers: defaultHandlers, batchSize: 7, now: () => now, random: () => 0.5 });
    for (let i = 1; i <= 40; i++) createCustomerLocal(db, { rif: rif(i), legalName: `Cliente ${i}` });
    for (let round = 0; round < 200 && db.select({ n: count() }).from(outbox).where(eq(outbox.status, 'DONE')).get()!.n < 40; round++) { await engine.run(); now += 60_000; }
    expect(db.select({ n: count() }).from(outbox).where(eq(outbox.status, 'DONE')).get()!.n).toBe(40);
    expect(applied.size).toBe(40); // sin duplicados ni pérdidas
    expect(new Set(db.select().from(customers).all().map((c) => c.id)).size).toBe(40);
    expect(db.select().from(customers).all().every((c) => !c.isLocal)).toBe(true);
  });
});

describe('migraciones con datos reales', () => {
  it('actualizar de la versión 0000 a la actual conserva clientes, documentos y la cola pendiente', () => {
    const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
    const apply = (f: string) => { for (const st of fs.readFileSync(path.join(dir, f), 'utf8').split('--> statement-breakpoint')) if (st.trim()) sqlite.exec(st); };
    apply(files[0]); // «versión instalada»
    sqlite.prepare("INSERT INTO customers (id, rif, legal_name, search_text, version, is_local) VALUES ('c1', 'V-19322174-9', 'Cliente viejo', 'cliente viejo', 3, 1)").run();
    sqlite.prepare("INSERT INTO sales_documents (id, doc_type, customer_id, currency_id, local_status, created_at_device, updated_at, local_number) VALUES ('d1', 'QUOTE', 'c1', 'usd', 'PENDING_SYNC', 'n', 'n', 'OFF-D01-000001')").run();
    sqlite.prepare("INSERT INTO outbox (client_op_id, client_seq, entity, action, entity_id, payload_json, created_at) VALUES ('op1', 1, 'customer', 'create', 'c1', '{}', 'n')").run();
    sqlite.prepare("INSERT INTO sync_meta (key, value) VALUES ('local_seq', '1')").run();
    for (const f of files.slice(1)) apply(f); // «actualización de la app»
    const db = drizzle(sqlite, { schema }) as unknown as AppDb;
    expect(db.select().from(customers).get()).toMatchObject({ id: 'c1', legalName: 'Cliente viejo', version: 3, isLocal: true });
    expect(db.select().from(outbox).get()).toMatchObject({ clientOpId: 'op1', status: 'PENDING' });
    expect(db.select().from(syncMeta).all()).toHaveLength(1);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='currencies'").get()).toBeTruthy(); // tablas nuevas creadas
    expect(db.select({ n: count() }).from(products).get()!.n).toBe(0);
  });
});

describe('sincronización en segundo plano', () => {
  const mk = (routes: Parameters<typeof fakeFetch>[0], opts: { refresh?: string | null; bootstrapped?: boolean; device?: boolean } = {}) => {
    const f = fakeFetch(routes); const tokens = memoryTokens(opts.refresh === undefined ? 'r1' : opts.refresh ?? undefined); const { db } = createTestDb();
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens, fetchImpl: f.impl });
    const dev = memoryDevice(); if (opts.device !== false) void dev.saveDeviceId('dev1');
    const auth = new AuthService(api, tokens, dev, { deviceName: 'P', newDeviceKey: () => 'k'.repeat(24), appVersion: '1' });
    if (opts.bootstrapped !== false) setMeta(db, META.bootstrapDoneAt, 'x');
    return { d: { api, auth, tokens, engine: new SyncEngine({ api, db, handlers: defaultHandlers }), db }, f, db };
  };
  it('sin sesión, sin descarga inicial o sin dispositivo no hace nada', async () => {
    expect(await runBackgroundSync(mk({}, { refresh: null }).d)).toBe('skipped');
    expect(await runBackgroundSync(mk({}, { bootstrapped: false }).d)).toBe('skipped');
    expect(await runBackgroundSync(mk({}, { device: false }).d)).toBe('skipped');
  });

  it('con sesión: renueva el token, envía la cola y descarga', async () => {
    const t = mk({ 'POST /auth/refresh': { body: { data: { accessToken: 'a', refreshToken: 'r2' } } }, 'POST /sync/push': (_u: URL, init: RequestInit) => ({ body: { data: { results: JSON.parse(String(init.body)).operations.map((o: PushOperation) => ({ clientOpId: o.clientOpId, status: 'APPLIED', serverId: 'srv' })), serverTime: 'x' } } }), 'GET /sync/pull': pull });
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'En segundo plano' });
    expect(await runBackgroundSync(t.d)).toBe('success');
    expect(t.db.select().from(outbox).get()!.status).toBe('DONE'); expect(t.d.tokens).toBeDefined();
  });

  it('sesión no renovable o sin red → failed, sin borrar nada ni lanzar errores', async () => {
    const bad = mk({ 'POST /auth/refresh': { status: 401, body: { error: 'REFRESH_INVALID' } } });
    createCustomerLocal(bad.db, { rif: rif(1), legalName: 'Pendiente' });
    expect(await runBackgroundSync(bad.d)).toBe('failed');
    expect(bad.db.select({ n: count() }).from(outbox).get()!.n).toBe(1);
    const down = mk({ 'POST /auth/refresh': { body: { data: { accessToken: 'a', refreshToken: 'r2' } } }, 'POST /sync/push': { status: 503, body: {} } });
    createCustomerLocal(down.db, { rif: rif(2), legalName: 'Cliente X' });
    expect(await runBackgroundSync(down.d)).toBe('failed');
  });
});

describe('políticas de sesión (M6)', () => {
  function setup(now: () => number) {
    const tokens = memoryTokens('r1'); const { db } = createTestDb();
    let session!: SessionService; let auth!: AuthService;
    const f = fakeFetch({ 'GET /app/config': { body: { data: { minAppVersion: '1.0.0', latestAppVersion: '1.0.0', schemaVersion: 1, maintenance: null, serverTime: 'x' } } }, 'POST /auth/logout': { status: 204 }, 'POST /auth/refresh': { body: { data: { accessToken: 'a', refreshToken: 'r2' } } },
      'POST /sync/push': { body: { data: { results: [], serverTime: 'x' } } }, 'GET /sync/pull': pull });
    const api: ApiClient = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1.0.0', tokens, fetchImpl: f.impl, getDeviceId: () => auth.deviceId });
    const dev = memoryDevice(); void dev.saveDeviceId('dev1');
    auth = new AuthService(api, tokens, dev, { deviceName: 'P', newDeviceKey: () => 'k'.repeat(24), appVersion: '1.0.0' });
    const pin = new PinLock(memoryPin(), nodeHasher);
    session = new SessionService({ api, auth, tokens, db, pin, biometric: { isAvailable: async () => false, authenticate: async () => false }, engine: new SyncEngine({ api, db, handlers: defaultHandlers }), appVersion: '1.0.0', versionLt, now });
    setMeta(db, META.companyId, 'c1'); setMeta(db, META.permissions, '[]'); setMeta(db, META.bootstrapDoneAt, new Date(now()).toISOString());
    return { session, db, tokens, pin };
  }

  it('más de 14 días sin sincronizar: exige iniciar sesión pero conserva datos y cola', async () => {
    const now = Date.UTC(2026, 9, 30);
    const t = setup(() => now); await t.pin.setPin('1234');
    setMeta(t.db, META.lastSyncAt, new Date(now - (POLICY.maxOfflineDays + 1) * DAY_MS).toISOString());
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Pendiente' });
    await t.session.start();
    expect(t.session.state.status).toBe('anonymous'); expect(t.session.state.error).toContain('más de 14 días'); expect(t.tokens.refresh).toBeNull();
    expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(1);
    // dentro del plazo: abre normalmente (bloqueado con PIN)
    const t2 = setup(() => now); await t2.pin.setPin('1234'); setMeta(t2.db, META.lastSyncAt, new Date(now - 10 * DAY_MS).toISOString());
    await t2.session.start(); expect(t2.session.state.status).toBe('locked');
  });

  it('dispositivo revocado: la cola se conserva 7 días y luego se borra todo', async () => {
    let now = Date.UTC(2026, 9, 1);
    const t = setup(() => now); await t.pin.setPin('1234');
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Pendiente' });
    setMeta(t.db, META.revokedAt, new Date(now).toISOString());
    now += 6 * DAY_MS; await t.session.start();
    expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(1); // dentro de la retención
    now += 2 * DAY_MS; await t.session.start();
    expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(0); expect(getMeta(t.db, META.companyId)).toBeNull(); // vencida: todo borrado
  });

  it('restablecer réplica: borra lo descargado, conserva la cola y vuelve a pedir la descarga', async () => {
    const t = setup(() => Date.now()); await t.pin.setPin('1234');
    t.db.insert(products).values({ id: 'p1', sku: 'S', name: 'P', searchText: 's p', version: 1 }).run();
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Pendiente' });
    t.session.resetReplica();
    expect(t.session.state.status).toBe('needs-bootstrap');
    expect(t.db.select({ n: count() }).from(products).get()!.n).toBe(0);
    expect(t.db.select({ n: count() }).from(outbox).get()!.n).toBe(1); expect(t.db.select({ n: count() }).from(customers).get()!.n).toBe(1);
    expect(t.session.state.queue.pending).toBe(1);
  });
});

describe('diagnóstico', () => {
  it('reúne conteos, cola, cursores y metadatos sin datos de negocio', () => {
    const { db } = createTestDb();
    createCustomerLocal(db, { rif: rif(1), legalName: 'Secreto S.A.' });
    setMeta(db, META.cursor('products'), 'c9'); setMeta(db, META.deviceCode, 'D07');
    const d = collectDiagnostics(db);
    expect(d.tables).toMatchObject({ customers: 1, outbox: 1, products: 0 }); expect(d.queue.PENDING).toBe(1);
    expect(d.cursors.products).toBe('c9'); expect(d.meta.deviceCode).toBe('D07'); expect(d.dbSizeBytes).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toContain('Secreto');
  });
});
