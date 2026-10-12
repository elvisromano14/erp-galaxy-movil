import { counts, enqueue, listQueue, markSending, nextBatch, nextSeq, recoverStale, setOutcome } from '../src/db/repositories/outbox';
import { uuidv7 } from '../src/core/uuid';
import { outbox } from '../src/db/schema';
import { createTestDb } from './testDb';

describe('uuidv7', () => {
  it('formato RFC 9562 (versión 7, variante 10xx) y orden por tiempo', () => {
    const a = uuidv7(1_700_000_000_000); const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(uuidv7(1_700_000_000_000)).not.toBe(a); // la parte aleatoria cambia
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(1_700_000_000_000); // los 48 bits son el reloj
  });
});

describe('outbox', () => {
  const ent = (id: string, extra: object = {}) => ({ entity: 'customer' as const, action: 'create' as const, entityId: id, payload: { n: 1 }, ...extra });

  it('asigna secuencia monótona y ids de operación únicos; lista en orden', () => {
    const { db } = createTestDb();
    const a = enqueue(db, ent('e1')); const b = enqueue(db, ent('e2')); const c = enqueue(db, ent('e3'));
    expect([a.clientSeq, b.clientSeq, c.clientSeq]).toEqual([1, 2, 3]);
    expect(new Set([a.clientOpId, b.clientOpId, c.clientOpId]).size).toBe(3);
    expect(nextBatch(db, 10, new Date().toISOString()).map((o) => o.entityId)).toEqual(['e1', 'e2', 'e3']);
    expect(nextSeq(db)).toBe(4);
  });

  it('coalescencia: update sobre create pendiente se funde; update sobre update reemplaza; distinta entidad no', () => {
    const { db } = createTestDb();
    enqueue(db, ent('e1', { payload: { rif: 'J-1', legalName: 'A' } }));
    const merged = enqueue(db, ent('e1', { action: 'update', payload: { legalName: 'B' } }));
    expect(merged.action).toBe('create'); expect(JSON.parse(merged.payloadJson)).toEqual({ rif: 'J-1', legalName: 'B' });
    expect(db.select().from(outbox).all()).toHaveLength(1);
    enqueue(db, ent('e2', { action: 'update', payload: { legalName: 'X' } }));
    enqueue(db, ent('e2', { action: 'update', payload: { legalName: 'Y' } }));
    expect(db.select().from(outbox).all()).toHaveLength(2);
    enqueue(db, ent('e3')); expect(db.select().from(outbox).all()).toHaveLength(3);
  });

  it('una operación ya en vuelo (SENDING) NO se coalesce: la edición va como operación nueva', () => {
    const { db } = createTestDb();
    const first = enqueue(db, ent('e1'));
    markSending(db, [first.clientOpId]);
    enqueue(db, ent('e1', { action: 'update', payload: { legalName: 'B' } }));
    expect(db.select().from(outbox).all().map((o) => `${o.action}:${o.status}`)).toEqual(['create:SENDING', 'update:PENDING']);
  });

  it('respeta la espera de reintento (next_attempt_at) y recupera las SENDING tras un cierre forzado', () => {
    const { db } = createTestDb();
    const a = enqueue(db, ent('e1')); const b = enqueue(db, ent('e2'));
    setOutcome(db, a.clientOpId, { status: 'PENDING', attempts: 1, nextAttemptAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(nextBatch(db, 10, new Date().toISOString()).map((o) => o.entityId)).toEqual(['e2']);
    markSending(db, [b.clientOpId]);
    expect(nextBatch(db, 10, new Date().toISOString())).toHaveLength(0);
    expect(recoverStale(db)).toBe(1);
    expect(counts(db)).toMatchObject({ PENDING: 2, SENDING: 0 });
  });

  it('la cola muestra pendientes, rechazadas y en revisión (no las hechas)', () => {
    const { db } = createTestDb();
    const [a, b, c] = ['e1', 'e2', 'e3'].map((id) => enqueue(db, ent(id)));
    setOutcome(db, a.clientOpId, { status: 'DONE' }); setOutcome(db, b.clientOpId, { status: 'REJECTED', error: 'X' });
    expect(listQueue(db).map((o) => o.entityId)).toEqual(['e3', 'e2']);
    expect(listQueue(db, true)).toHaveLength(3); expect(c.clientSeq).toBe(3);
  });
});
