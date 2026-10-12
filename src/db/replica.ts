import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { AppDb } from './types';
import { META, deleteMeta } from './meta';
import {
  appSettings, currencies, customers, exchangeRates, priceLists, productPrices, productRefs, products, salesDocumentLines, salesDocuments, stockSnapshots, taxes, warehouses,
} from './schema';
import { PULL_ORDER } from '../core/api/contract';

/**
 * Borra la réplica (catálogos, clientes, existencias, documentos que vinieron del servidor) y los cursores.
 * NUNCA toca el outbox ni los documentos con cambios locales (borradores, pendientes, rechazados, en revisión): "restablecer réplica" no pierde trabajo.
 */
export function wipeReplica(db: AppDb): void {
  db.transaction((tx) => {
    for (const t of [productRefs, productPrices, products, stockSnapshots, warehouses, customers, taxes, exchangeRates, priceLists, currencies, appSettings]) tx.delete(t).run();
    const synced = tx.select({ id: salesDocuments.id }).from(salesDocuments).where(or(eq(salesDocuments.localStatus, 'SYNCED'), isNull(salesDocuments.localStatus))).all().map((r) => r.id);
    if (synced.length) {
      for (let i = 0; i < synced.length; i += 500) {
        const ids = synced.slice(i, i + 500);
        tx.delete(salesDocumentLines).where(inArray(salesDocumentLines.documentId, ids)).run();
        tx.delete(salesDocuments).where(and(inArray(salesDocuments.id, ids))).run();
      }
    }
    for (const e of PULL_ORDER) deleteMeta(tx as AppDb, META.cursor(e));
    deleteMeta(tx as AppDb, META.bootstrapDoneAt);
    deleteMeta(tx as AppDb, META.lastSyncAt);
  });
}

