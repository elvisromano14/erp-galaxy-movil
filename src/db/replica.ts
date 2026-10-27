import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import type { AppDb } from './types';
import { META, deleteMeta } from './meta';
import {
  appSettings, categories, currencies, customers, locations, units, exchangeRates, outbox, syncLog, syncMeta, priceLists, productPrices, productRefs, products, salesDocumentLines, salesDocuments, stockSnapshots, taxes, warehouses,
} from './schema';
import { PULL_ORDER } from '../core/api/contract';

/** Borra TODO (réplica, documentos, clientes, cola y metadatos): solo tras vencer la retención de un dispositivo revocado. */
export function wipeEverything(db: AppDb): void {
  db.transaction((tx) => {
    for (const t of [productRefs, productPrices, products, stockSnapshots, warehouses, locations, units, categories, customers, taxes, exchangeRates, priceLists, currencies, appSettings, salesDocumentLines, salesDocuments, outbox, syncMeta, syncLog]) tx.delete(t).run();
  });
}

/**
 * Borra la réplica (catálogos, clientes, existencias, documentos que vinieron del servidor) y los cursores.
 * NUNCA toca el outbox ni los documentos con cambios locales (borradores, pendientes, rechazados, en revisión): "restablecer réplica" no pierde trabajo.
 */
export function wipeReplica(db: AppDb): void {
  db.transaction((tx) => {
    // Productos creados en el teléfono y aún sin confirmar: se conservan con sus códigos y precio local (su operación sigue en el outbox).
    const localProducts = tx.select({ id: products.id }).from(products).where(eq(products.isLocal, true)).all().map((r) => r.id);
    if (localProducts.length) {
      tx.delete(productRefs).where(notInArray(productRefs.productId, localProducts)).run();
      tx.delete(productPrices).where(notInArray(productPrices.productId, localProducts)).run();
    } else { tx.delete(productRefs).run(); tx.delete(productPrices).run(); }
    tx.delete(products).where(eq(products.isLocal, false)).run();
    for (const t of [stockSnapshots, warehouses, locations, units, categories, taxes, exchangeRates, priceLists, currencies, appSettings]) tx.delete(t).run();
    // Clientes creados en el teléfono y aún sin confirmar por el servidor: se conservan (su operación sigue en el outbox).
    tx.delete(customers).where(eq(customers.isLocal, false)).run();
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

