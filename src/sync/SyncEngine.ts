import { eq } from 'drizzle-orm';
import type { ApiClient } from '../core/api/ApiClient';
import type { OpResult, PushOperation } from '../core/api/contract';
import { ApiError } from '../core/api/errors';
import { markSending, nextBatch, type OutboxRow, recoverStale, setOutcome } from '../db/repositories/outbox';
import { syncLog } from '../db/schema';
import type { AppDb } from '../db/types';
import { nextAttemptAt } from './backoff';
import { syncNow } from './bootstrap';

/** Reacciones por entidad a los resultados del servidor (clientes en M3; cotizaciones y pedidos en M4/M5). */
export interface ResultHandler {
  applied?(db: AppDb, op: OutboxRow, r: OpResult): void;
  rejected?(db: AppDb, op: OutboxRow, r: OpResult): void;
  review?(db: AppDb, op: OutboxRow, r: OpResult): void;
}

export interface SyncSummary {
  pushed: number; applied: number; rejected: number; review: number; blocked: number; retry: number;
  pulled: Record<string, number> | null;
  /** Sin conexión (o servidor caído): lo pendiente se reintentará con espera creciente. */
  offline: boolean;
}

export interface SyncEngineDeps {
  api: ApiClient; db: AppDb;
  handlers: Partial<Record<string, ResultHandler>>;
  batchSize?: number; now?: () => number; random?: () => number;
  /** Espera antes de reintentar una operación BLOQUEADA por una dependencia rechazada. */
  blockedRetryMs?: number;
}

const wire = (o: OutboxRow): PushOperation => ({ clientOpId: o.clientOpId, clientSeq: o.clientSeq, entity: o.entity as PushOperation['entity'], action: o.action as PushOperation['action'], entityId: o.entityId, data: JSON.parse(o.payloadJson) });

/**
 * Motor de sincronización: PUSH (cola de salida, en lotes y por orden) y luego PULL. Un solo ciclo a la vez (mutex):
 * una segunda llamada comparte el ciclo en curso. Reintentos con espera exponencial y *jitter*; los errores que bloquean la app
 * (dispositivo revocado, versión obsoleta) se propagan; los de red dejan la cola intacta.
 */
export class SyncEngine {
  private running: Promise<SyncSummary> | null = null;
  constructor(private readonly d: SyncEngineDeps) {}

  get isRunning() { return this.running !== null; }

  run(o: { pull?: boolean } = {}): Promise<SyncSummary> {
    this.running ??= this.execute(o).finally(() => { this.running = null; });
    return this.running;
  }

  private async execute(o: { pull?: boolean }): Promise<SyncSummary> {
    const { db, api } = this.d;
    const now = this.d.now ?? Date.now;
    const sum: SyncSummary = { pushed: 0, applied: 0, rejected: 0, review: 0, blocked: 0, retry: 0, pulled: null, offline: false };
    const log = db.insert(syncLog).values({ startedAt: new Date(now()).toISOString() }).returning({ id: syncLog.id }).get();
    let ok = false;
    try {
      recoverStale(db);
      await this.push(sum);
      if (o.pull !== false && !sum.offline) {
        try { sum.pulled = await syncNow(api, db); } catch (e) {
          if (e instanceof ApiError && e.blocksApp) throw e;
          if (e instanceof ApiError && (e.isRetryable || e.status === 401)) sum.offline = true; else throw e;
        }
      }
      ok = !sum.offline;
      return sum;
    } finally {
      db.update(syncLog).set({ finishedAt: new Date(now()).toISOString(), ok, summary: JSON.stringify(sum) }).where(eq(syncLog.id, log.id)).run();
    }
  }

  private async push(sum: SyncSummary) {
    const { db, api } = this.d;
    const now = this.d.now ?? Date.now;
    for (;;) {
      const ops = nextBatch(db, this.d.batchSize ?? 20, new Date(now()).toISOString());
      if (!ops.length) return;
      markSending(db, ops.map((x) => x.clientOpId));
      let results: OpResult[];
      try {
        results = (await api.post<{ results: OpResult[] }>('/sync/push', { operations: ops.map(wire) })).results;
      } catch (e) {
        if (e instanceof ApiError && e.blocksApp) { this.release(ops); throw e; }
        if (e instanceof ApiError && (e.isRetryable || e.status === 401)) {
          // Sin red / servidor caído / sesión no renovable: nada se pierde; se reintenta con espera creciente.
          for (const op of ops) this.retryLater(op);
          sum.offline = true; sum.retry += ops.length; return;
        }
        // Rechazo de todo el lote (p. ej. 400): se marcan rechazadas para no entrar en un bucle.
        for (const op of ops) { setOutcome(db, op.clientOpId, { status: 'REJECTED', error: e instanceof ApiError ? `${e.code}: ${e.message}` : String(e) }); sum.rejected++; }
        continue;
      }
      const byId = new Map(results.map((r) => [r.clientOpId, r]));
      for (const op of ops) {
        const r = byId.get(op.clientOpId);
        if (!r) { this.retryLater(op); sum.retry++; continue; }
        sum.pushed++;
        this.applyResult(op, r, sum);
      }
    }
  }

  private applyResult(op: OutboxRow, r: OpResult, sum: SyncSummary) {
    const { db } = this.d;
    const h = this.d.handlers[op.entity];
    const guard = (fn?: () => void) => { try { fn?.(); } catch (e) { setOutcome(db, op.clientOpId, { status: 'REJECTED', error: `Error local al aplicar el resultado: ${(e as Error).message}` }); } };
    const label = r.errorCode ? `${r.errorCode}: ${r.message ?? ''}`.trim() : (r.message ?? null);
    switch (r.status) {
      case 'APPLIED': case 'DUPLICATE':
        db.transaction((tx) => { guard(() => h?.applied?.(tx as AppDb, op, r)); setOutcome(tx as AppDb, op.clientOpId, { status: 'DONE' }); });
        sum.applied++; break;
      case 'REJECTED':
        db.transaction((tx) => { guard(() => h?.rejected?.(tx as AppDb, op, r)); setOutcome(tx as AppDb, op.clientOpId, { status: 'REJECTED', error: label }); });
        sum.rejected++; break;
      case 'NEEDS_REVIEW':
        db.transaction((tx) => { guard(() => h?.review?.(tx as AppDb, op, r)); setOutcome(tx as AppDb, op.clientOpId, { status: 'REVIEW', error: label }); });
        sum.review++; break;
      case 'BLOCKED':
        // Depende de una operación rechazada: sigue pendiente, sin gastar intentos, hasta que se resuelva.
        setOutcome(db, op.clientOpId, { status: 'PENDING', error: label, attempts: op.attempts, nextAttemptAt: new Date((this.d.now ?? Date.now)() + (this.d.blockedRetryMs ?? 300_000)).toISOString() });
        sum.blocked++; break;
      default: // RETRY (error temporal del servidor)
        this.retryLater(op, label); sum.retry++;
    }
  }

  private retryLater(op: OutboxRow, error?: string | null) {
    const attempts = op.attempts + 1;
    setOutcome(this.d.db, op.clientOpId, { status: 'PENDING', error: error ?? op.lastError, attempts, nextAttemptAt: nextAttemptAt(attempts, (this.d.now ?? Date.now)(), this.d.random) });
  }

  /** Devuelve las operaciones a PENDING sin gastar intentos (el envío no llegó a ocurrir por un bloqueo de la app). */
  private release(ops: OutboxRow[]) { for (const op of ops) setOutcome(this.d.db, op.clientOpId, { status: 'PENDING', error: op.lastError, attempts: op.attempts }); }
}
