import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { uuidv7 } from '../../core/uuid';
import { META, getMeta, setMeta } from '../meta';
import { outbox } from '../schema';
import type { AppDb } from '../types';

export type OutboxStatus = 'PENDING' | 'SENDING' | 'DONE' | 'REJECTED' | 'REVIEW';
export type OutboxRow = typeof outbox.$inferSelect;
export type SyncEntityName = 'customer' | 'sales_quote' | 'sales_order';

/** Siguiente número de secuencia del dispositivo (monótono). Debe llamarse DENTRO de la transacción que crea la operación. */
export function nextSeq(db: AppDb): number {
  const n = Number(getMeta(db, META.localSeq) ?? '0') + 1;
  setMeta(db, META.localSeq, String(n));
  return n;
}

export interface EnqueueInput { entity: SyncEntityName; action: 'create' | 'update'; entityId: string; payload: Record<string, unknown>; now?: Date }

/**
 * Agrega una operación a la cola. Regla de oro: se llama DENTRO de la misma transacción SQLite que modifica el documento/cliente
 * (nunca una sin la otra). Coalescencia: si ya hay una operación PENDIENTE (sin enviar) de la misma entidad, se reemplaza su
 * contenido en lugar de crear otra (un `update` sobre un `create` pendiente se funde en el `create`).
 */
export function enqueue(db: AppDb, i: EnqueueInput): OutboxRow {
  const pending = db.select().from(outbox).where(and(eq(outbox.entity, i.entity), eq(outbox.entityId, i.entityId), eq(outbox.status, 'PENDING'))).orderBy(desc(outbox.clientSeq)).get();
  if (pending && (pending.action === 'create' || pending.action === i.action)) {
    const merged = pending.action === 'create' && i.action === 'update'
      ? { ...JSON.parse(pending.payloadJson), ...i.payload }
      : i.payload;
    return db.update(outbox).set({ payloadJson: JSON.stringify(merged), attempts: 0, nextAttemptAt: null, lastError: null }).where(eq(outbox.clientOpId, pending.clientOpId)).returning().get();
  }
  return db.insert(outbox).values({
    clientOpId: uuidv7(), clientSeq: nextSeq(db), entity: i.entity, action: i.action, entityId: i.entityId,
    payloadJson: JSON.stringify(i.payload), status: 'PENDING', attempts: 0, createdAt: (i.now ?? new Date()).toISOString(),
  }).returning().get();
}

/** Operaciones listas para enviar (PENDING cuya espera ya venció), en orden de secuencia. */
export function nextBatch(db: AppDb, limit: number, nowIso: string): OutboxRow[] {
  return db.select().from(outbox)
    .where(and(eq(outbox.status, 'PENDING'), or(isNull(outbox.nextAttemptAt), lte(outbox.nextAttemptAt, nowIso))))
    .orderBy(asc(outbox.clientSeq)).limit(limit).all();
}

export function markSending(db: AppDb, ids: string[]) {
  if (ids.length) db.update(outbox).set({ status: 'SENDING' }).where(inArray(outbox.clientOpId, ids)).run();
}

/** Tras un cierre forzado a mitad de envío, las operaciones SENDING vuelven a PENDING (es seguro: el servidor es idempotente). */
export function recoverStale(db: AppDb): number {
  return db.update(outbox).set({ status: 'PENDING' }).where(eq(outbox.status, 'SENDING')).returning({ id: outbox.clientOpId }).all().length;
}

export function setOutcome(db: AppDb, clientOpId: string, p: { status: OutboxStatus; error?: string | null; attempts?: number; nextAttemptAt?: string | null }) {
  db.update(outbox).set({ status: p.status, lastError: p.error ?? null, ...(p.attempts !== undefined ? { attempts: p.attempts } : {}), nextAttemptAt: p.nextAttemptAt ?? null }).where(eq(outbox.clientOpId, clientOpId)).run();
}

export function counts(db: AppDb): Record<OutboxStatus, number> {
  const out: Record<OutboxStatus, number> = { PENDING: 0, SENDING: 0, DONE: 0, REJECTED: 0, REVIEW: 0 };
  for (const r of db.select({ s: outbox.status, n: count() }).from(outbox).groupBy(outbox.status).all()) out[r.s as OutboxStatus] = r.n;
  return out;
}

/** Operaciones que requieren atención o están en camino (la pantalla de sincronización), las más nuevas primero. */
export function listQueue(db: AppDb, includeDone = false): OutboxRow[] {
  return db.select().from(outbox).where(includeDone ? sql`1=1` : inArray(outbox.status, ['PENDING', 'SENDING', 'REJECTED', 'REVIEW'])).orderBy(desc(outbox.clientSeq)).limit(200).all();
}

export const latestForEntity = (db: AppDb, entity: SyncEntityName, entityId: string): OutboxRow | undefined =>
  db.select().from(outbox).where(and(eq(outbox.entity, entity), eq(outbox.entityId, entityId))).orderBy(desc(outbox.clientSeq)).get();
