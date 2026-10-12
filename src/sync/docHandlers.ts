import { eq } from 'drizzle-orm';
import { salesDocuments } from '../db/schema';
import type { AppDb } from '../db/types';
import type { OpResult } from '../core/api/contract';
import type { OutboxRow } from '../db/repositories/outbox';
import type { ResultHandler } from './SyncEngine';

const label = (r: OpResult) => (r.errorCode ? `${r.errorCode}: ${r.message ?? ''}`.trim() : (r.message ?? null));

/** Resultados de cotizaciones/pedidos: el documento local refleja el número definitivo y el estado del servidor (el servidor es autoritativo). */
export const salesDocHandler: ResultHandler = {
  applied(db: AppDb, op: OutboxRow, r: OpResult) {
    db.update(salesDocuments).set({ serverId: r.serverId ?? null, serverNumber: r.serverNumber ?? null, serverStatus: r.serverStatus ?? null, localStatus: 'SYNCED', syncError: null })
      .where(eq(salesDocuments.id, op.entityId)).run();
  },
  rejected(db: AppDb, op: OutboxRow, r: OpResult) {
    db.update(salesDocuments).set({ localStatus: 'REJECTED', syncError: label(r) }).where(eq(salesDocuments.id, op.entityId)).run();
  },
  review(db: AppDb, op: OutboxRow, r: OpResult) {
    db.update(salesDocuments).set({ localStatus: 'NEEDS_REVIEW', serverId: r.serverId ?? null, serverNumber: r.serverNumber ?? null, serverStatus: r.serverStatus ?? null, syncError: label(r) })
      .where(eq(salesDocuments.id, op.entityId)).run();
  },
};
