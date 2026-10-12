import { ApiClient } from '../src/core/api/ApiClient';
import type { OpResult, PushOperation } from '../src/core/api/contract';
import { createCustomerLocal, updateCustomerLocal } from '../src/db/repositories/customers';
import { enqueue } from '../src/db/repositories/outbox';
import { customers, outbox, salesDocuments, syncLog } from '../src/db/schema';
import { defaultHandlers } from '../src/sync/handlers';
import { SyncEngine } from '../src/sync/SyncEngine';
import { fakeFetch, memoryTokens } from './helpers';
import { createTestDb } from './testDb';

const rif = (n: number) => { const W = [4, 3, 2, 7, 6, 5, 4, 3, 2]; const d = String(n).padStart(8, '0'); const s = [1, ...d.split('').map(Number)].reduce((a, x, i) => a + x * W[i], 0); const c = 11 - (s % 11); return `V-${d}-${c >= 10 ? 0 : c}`; };

/** Servidor de `sync/push` simulado: aplica por clientOpId (idempotente) con resultados programables por entidad. */
function pushServer(over: (op: PushOperation) => Partial<OpResult> | undefined = () => undefined) {
  const applied = new Map<string, OpResult>(); const requests: PushOperation[][] = []; let n = 0;
  const state = { drop: 0 as number, down: 0 as number, status: 200 as number, body: undefined as unknown };
  const handler = (_u: URL, init: RequestInit) => {
    const ops: PushOperation[] = JSON.parse(String(init.body)).operations; requests.push(ops);
    if (state.down > 0) { state.down--; return { status: 503, body: { error: 'DOWN' } }; }
    if (state.status !== 200) return { status: state.status, body: state.body ?? { error: 'X' } };
    const results = ops.map((op) => {
      const prev = applied.get(op.clientOpId); if (prev) return { ...prev, status: 'DUPLICATE' as const };
      const special = over(op);
      const r: OpResult = { clientOpId: op.clientOpId, status: 'APPLIED', serverId: `srv-${++n}`, serverStatus: 'PENDING', ...special };
      if (r.status === 'APPLIED') applied.set(op.clientOpId, r);
      return r;
    });
    return { body: { data: { results, serverTime: 'x' } } };
  };
  return { handler, requests, applied, state };
}

function setup(srv = pushServer(), opts: { now?: () => number; batchSize?: number } = {}) {
  const f = fakeFetch({
    'POST /sync/push': srv.handler as never,
    'GET /sync/pull': (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: true, serverTime: 'x' } } }),
  });
  let lose = 0; // respuestas perdidas: el servidor procesa pero el cliente no ve la respuesta
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await f.impl(input, init);
    if (String(input).includes('/sync/push') && lose > 0) { lose--; throw new TypeError('Network request failed'); }
    return res;
  }) as typeof fetch;
  const { db } = createTestDb();
  const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1.0.0', tokens: memoryTokens(), fetchImpl: impl });
  const engine = new SyncEngine({ api, db, handlers: defaultHandlers, now: opts.now, batchSize: opts.batchSize, random: () => 0.5 });
  return { engine, db, srv, f, loseNext: (n = 1) => { lose = n; } };
}
const status = (db: ReturnType<typeof setup>['db']) => db.select().from(outbox).all().map((o) => o.status);

describe('SyncEngine — push', () => {
  it('envía la cola en orden; el alta confirmada deja el cliente con el id del servidor y los documentos re-apuntados', async () => {
    const t = setup();
    const c = createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente 1' });
    t.db.insert(salesDocuments).values({ id: 'd1', docType: 'QUOTE', customerId: c.id, currencyId: 'usd', createdAtDevice: 'n', updatedAt: 'n' }).run();
    const r = await t.engine.run();
    expect(r).toMatchObject({ pushed: 1, applied: 1, rejected: 0, offline: false });
    expect(status(t.db)).toEqual(['DONE']);
    expect(t.db.select().from(customers).get()).toMatchObject({ id: 'srv-1', isLocal: false, validationStatus: 'PENDING' });
    expect(t.db.select().from(salesDocuments).get()!.customerId).toBe('srv-1');
    expect(t.srv.requests[0][0]).toMatchObject({ entity: 'customer', action: 'create', entityId: c.id, clientSeq: 1 });
    expect(t.db.select().from(syncLog).get()).toMatchObject({ ok: true });
  });

  it('10 clientes sin conexión → reconectar: aparecen EXACTAMENTE 10 veces; reintentar no duplica', async () => {
    const t = setup();
    for (let i = 1; i <= 10; i++) createCustomerLocal(t.db, { rif: rif(i), legalName: `Cliente ${i}` });
    await t.engine.run();
    expect(t.srv.applied.size).toBe(10); expect(status(t.db).every((s) => s === 'DONE')).toBe(true);
    await t.engine.run(); // sin nada pendiente: no hay más envíos
    expect(t.srv.requests).toHaveLength(1); expect(t.srv.applied.size).toBe(10);
  });

  it('corte de red a mitad: el servidor aplicó pero la respuesta se perdió → al reintentar responde DUPLICATE, sin duplicados ni pérdidas', async () => {
    let t = setup(); let now = 1_000_000; t = setup(pushServer(), { now: () => now });
    for (let i = 1; i <= 3; i++) createCustomerLocal(t.db, { rif: rif(i), legalName: `Cliente ${i}` });
    t.loseNext(1);
    const first = await t.engine.run();
    expect(first.offline).toBe(true); expect(t.srv.applied.size).toBe(3); // el servidor sí las aplicó
    expect(status(t.db)).toEqual(['PENDING', 'PENDING', 'PENDING']); expect(t.db.select().from(outbox).all()[0].attempts).toBe(1);
    // todavía no vence la espera: no se reenvía
    expect((await t.engine.run()).pushed).toBe(0);
    now += 60_000;
    const second = await t.engine.run();
    expect(second).toMatchObject({ pushed: 3, applied: 3 }); expect(t.srv.applied.size).toBe(3);
    expect(status(t.db)).toEqual(['DONE', 'DONE', 'DONE']);
    expect(t.db.select().from(customers).all().map((c) => c.id).sort()).toEqual(['srv-1', 'srv-2', 'srv-3']);
  });

  it('servidor caído (503): nada se pierde, intentos +1 con espera creciente, y no intenta el pull', async () => {
    let now = 5_000_000; const t = setup(undefined, { now: () => now });
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    t.srv.state.down = 2;
    const r = await t.engine.run();
    expect(r).toMatchObject({ offline: true, pulled: null });
    expect(t.f.calls.filter((c) => c.path === '/sync/pull')).toHaveLength(0);
    let op = t.db.select().from(outbox).get()!; expect(op).toMatchObject({ status: 'PENDING', attempts: 1 }); expect(new Date(op.nextAttemptAt!).getTime()).toBe(now + 5_000);
    now += 6_000; await t.engine.run();
    op = t.db.select().from(outbox).get()!; expect(op.attempts).toBe(2); expect(new Date(op.nextAttemptAt!).getTime()).toBe(now + 15_000);
    now += 16_000; expect((await t.engine.run()).applied).toBe(1);
  });

  it('REJECTED: queda con el motivo y la fila local se conserva para corregirla y reenviar', async () => {
    const t = setup(pushServer(() => ({ status: 'REJECTED', errorCode: 'CUSTOMER_CREATE_NOT_ALLOWED', message: 'No tiene permitido crear clientes' })));
    const c = createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    const r = await t.engine.run();
    expect(r.rejected).toBe(1);
    expect(t.db.select().from(outbox).get()).toMatchObject({ status: 'REJECTED', lastError: 'CUSTOMER_CREATE_NOT_ALLOWED: No tiene permitido crear clientes' });
    expect(t.db.select().from(customers).get()).toMatchObject({ id: c.id, isLocal: true });
  });

  it('NEEDS_REVIEW → REVIEW; BLOCKED → sigue pendiente sin gastar intentos y con espera; RETRY → intentos +1', async () => {
    let now = 9_000_000;
    const t = setup(pushServer((op) => (op.entityId.startsWith('a') ? { status: 'NEEDS_REVIEW', errorCode: 'CREDIT_LIMIT_EXCEEDED', message: 'Excede el límite' } : op.entityId.startsWith('b') ? { status: 'BLOCKED', errorCode: 'DEPENDENCY_REJECTED' } : { status: 'RETRY', errorCode: 'INTERNAL' })), { now: () => now });
    for (const id of ['a1', 'b1', 'c1']) enqueue(t.db, { entity: 'sales_order', action: 'create', entityId: id, payload: {} });
    const r = await t.engine.run();
    expect(r).toMatchObject({ review: 1, blocked: 1, retry: 1 });
    const by = Object.fromEntries(t.db.select().from(outbox).all().map((o) => [o.entityId, o]));
    expect(by.a1).toMatchObject({ status: 'REVIEW' }); expect(by.a1.lastError).toContain('CREDIT_LIMIT_EXCEEDED');
    expect(by.b1).toMatchObject({ status: 'PENDING', attempts: 0 }); expect(new Date(by.b1.nextAttemptAt!).getTime()).toBe(now + 300_000);
    expect(by.c1).toMatchObject({ status: 'PENDING', attempts: 1 });
  });

  it('lotes de 20: 45 operaciones = 3 envíos, en orden', async () => {
    const t = setup(undefined, { batchSize: 20 });
    for (let i = 1; i <= 45; i++) enqueue(t.db, { entity: 'sales_quote', action: 'create', entityId: `q${i}`, payload: {} });
    await t.engine.run();
    expect(t.srv.requests.map((r) => r.length)).toEqual([20, 20, 5]);
    expect(t.srv.requests.flat().map((o) => o.clientSeq)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  });

  it('un solo ciclo a la vez: dos llamadas simultáneas comparten el mismo envío (mutex)', async () => {
    const t = setup();
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    const [a, b] = await Promise.all([t.engine.run(), t.engine.run()]);
    expect(a).toBe(b); expect(t.srv.requests).toHaveLength(1); expect(t.engine.isRunning).toBe(false);
  });

  it('tras un cierre forzado, las operaciones SENDING se recuperan y se reenvían (el servidor es idempotente)', async () => {
    const t = setup();
    createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    t.db.update(outbox).set({ status: 'SENDING' }).run();
    expect((await t.engine.run()).applied).toBe(1);
  });

  it('dispositivo revocado / versión obsoleta: se propaga y la cola queda intacta (sin gastar intentos)', async () => {
    const t = setup(); createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    t.srv.state.status = 403; t.srv.state.body = { error: 'DEVICE_REVOKED', message: 'Revocado' };
    await expect(t.engine.run()).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(t.db.select().from(outbox).get()).toMatchObject({ status: 'PENDING', attempts: 0 });
    t.srv.state.status = 426; t.srv.state.body = { error: 'UPGRADE_REQUIRED', message: 'Actualice' };
    await expect(t.engine.run()).rejects.toMatchObject({ code: 'UPGRADE_REQUIRED' });
    expect(t.db.select().from(outbox).get()!.status).toBe('PENDING');
  });

  it('una edición posterior al envío va como operación nueva y no pisa la ya enviada', async () => {
    const t = setup();
    const c = createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    await t.engine.run();
    updateCustomerLocal(t.db, 'srv-1', { legalName: 'A editado' });
    expect(c.id).not.toBe('srv-1');
    await t.engine.run();
    expect(t.srv.requests.flat().map((o) => `${o.action}:${o.entityId}`)).toEqual([`create:${c.id}`, 'update:srv-1']);
  });

  it('el pull posterior al push corre en el mismo ciclo (push antes que pull)', async () => {
    const t = setup(); createCustomerLocal(t.db, { rif: rif(1), legalName: 'Cliente A' });
    const r = await t.engine.run();
    expect(r.pulled).not.toBeNull();
    const order = t.f.calls.map((c) => c.path); expect(order.indexOf('/sync/push')).toBeLessThan(order.indexOf('/sync/pull'));
  });
});
