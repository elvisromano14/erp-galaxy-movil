import { and, eq, inArray, sql } from 'drizzle-orm';
import { computeTotals } from '../../features/documents/calc';
import { priceListFor, priceOf } from '../../features/documents/pricing';
import { uuidv7 } from '../../core/uuid';
import { caracasToday } from '../../core/format';
import { META, getMeta, setMeta } from '../meta';
import { salesDocumentLines, salesDocuments } from '../schema';
import type { AppDb } from '../types';
import { enqueue, latestForEntity } from './outbox';
import { getAppSettings } from './settings';

export type DocType = 'QUOTE' | 'ORDER';
export type LocalStatus = 'DRAFT' | 'PENDING_SYNC' | 'SYNCED' | 'REJECTED' | 'NEEDS_REVIEW';
export type DocRow = typeof salesDocuments.$inferSelect;
export type DocLineRow = typeof salesDocumentLines.$inferSelect;

export interface DraftLine { productId: string; sku: string | null; description: string | null; quantity: string; unitPrice: string; discountPct: string; taxId: string | null; taxRate: string; taxExempt?: boolean }
export interface DraftInput {
  id?: string; docType: DocType; customerId: string; currencyId: string; paymentCondition: 'CASH' | 'CREDIT'; creditDays: number;
  validUntil: string | null; notes: string | null; warehouseId: string | null; sourceDocumentId?: string | null; lines: DraftLine[];
}

export class DocumentError extends Error {
  constructor(message: string, readonly code: 'NOT_FOUND' | 'NOT_EDITABLE' | 'INVALID') { super(message); this.name = 'DocumentError'; }
}

/** DRAFT y PENDING_SYNC (aún sin enviar) y REJECTED se pueden editar; lo ya enviado es de solo lectura (los cambios se hacen en la oficina). */
export const isEditable = (d: Pick<DocRow, 'localStatus'>) => ['DRAFT', 'PENDING_SYNC', 'REJECTED'].includes(d.localStatus);

/** Siguiente número provisional `OFF-{dispositivo}-{secuencia}`; se incrementa en la MISMA transacción que crea el documento (plan §7.5). */
function nextLocalNumber(db: AppDb): string {
  const n = Number(getMeta(db, 'doc_seq') ?? '0') + 1;
  setMeta(db, 'doc_seq', String(n));
  return `OFF-${getMeta(db, META.deviceCode) ?? 'D00'}-${String(n).padStart(6, '0')}`;
}

const lineValues = (documentId: string, l: DraftLine) => {
  const t = computeTotals([{ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, taxExempt: !!l.taxExempt || Number(l.taxRate) === 0 }]).lines[0];
  return { id: uuidv7(), documentId, productId: l.productId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct || '0', taxId: l.taxId, taxRate: l.taxRate || '0', lineTotal: t.net };
};

/** Guarda (crea o actualiza) el borrador con sus líneas y totales. Sin tocar la cola: eso ocurre al enviar. */
export function saveDraft(db: AppDb, input: DraftInput, now = new Date()): string {
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const existing = input.id ? t.select().from(salesDocuments).where(eq(salesDocuments.id, input.id)).get() : undefined;
    if (existing && !isEditable(existing)) throw new DocumentError('El documento ya se envió: solo lectura', 'NOT_EDITABLE');
    const totals = computeTotals(input.lines.map((l) => ({ ...l, taxExempt: !!l.taxExempt || Number(l.taxRate) === 0 })));
    const id = existing?.id ?? input.id ?? uuidv7(now.getTime());
    const row = {
      docType: input.docType, customerId: input.customerId, currencyId: input.currencyId, paymentCondition: input.paymentCondition, creditDays: input.creditDays,
      warehouseId: input.warehouseId, validUntil: input.validUntil, notes: input.notes, sourceDocumentId: input.sourceDocumentId ?? null,
      subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, updatedAt: now.toISOString(),
    };
    if (existing) t.update(salesDocuments).set({ ...row, version: existing.version + 1 }).where(eq(salesDocuments.id, id)).run();
    else t.insert(salesDocuments).values({ id, ...row, localStatus: 'DRAFT', createdAtDevice: now.toISOString(), version: 1 }).run();
    t.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, id)).run();
    for (const l of input.lines) t.insert(salesDocumentLines).values(lineValues(id, l)).run();
    return id;
  });
}

export interface DocumentView { doc: DocRow; lines: DocLineRow[]; customerName: string | null; editable: boolean; displayNumber: string; lastOpError: string | null }

export function getDocument(db: AppDb, id: string): DocumentView | null {
  const doc = db.select().from(salesDocuments).where(eq(salesDocuments.id, id)).get();
  if (!doc) return null;
  const lines = db.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, id)).all();
  const customer = db.all<{ name: string }>(sql`SELECT legal_name AS name FROM customers WHERE id = ${doc.customerId}`)[0];
  const op = latestForEntity(db, doc.docType === 'ORDER' ? 'sales_order' : 'sales_quote', id);
  return { doc, lines, customerName: customer?.name ?? null, editable: isEditable(doc), displayNumber: doc.serverNumber ?? doc.localNumber ?? '(borrador)', lastOpError: doc.syncError ?? op?.lastError ?? null };
}

export interface DocListRow { id: string; docType: string; displayNumber: string; customerName: string | null; total: string; currencyId: string; localStatus: string; serverStatus: string | null; updatedAt: string }

export function listDocuments(db: AppDb, o: { docType?: DocType; status?: LocalStatus; query?: string; limit?: number; offset?: number } = {}): DocListRow[] {
  const where = [sql`d.doc_type IN ('QUOTE', 'ORDER')`];
  if (o.docType) where.push(sql`d.doc_type = ${o.docType}`);
  if (o.status) where.push(sql`d.local_status = ${o.status}`);
  const q = o.query?.trim().toLowerCase();
  if (q) where.push(sql`(lower(COALESCE(d.server_number, d.local_number, '')) LIKE ${'%' + q + '%'} OR lower(COALESCE(c.legal_name, '')) LIKE ${'%' + q + '%'})`);
  return db.all<{ id: string; docType: string; serverNumber: string | null; localNumber: string | null; customerName: string | null; total: string; currencyId: string; localStatus: string; serverStatus: string | null; updatedAt: string }>(sql`
    SELECT d.id, d.doc_type AS docType, d.server_number AS serverNumber, d.local_number AS localNumber, c.legal_name AS customerName, d.total, d.currency_id AS currencyId,
           d.local_status AS localStatus, d.server_status AS serverStatus, d.updated_at AS updatedAt
    FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id WHERE ${sql.join(where, sql` AND `)}
    ORDER BY d.updated_at DESC LIMIT ${o.limit ?? 50} OFFSET ${o.offset ?? 0}`)
    .map((r) => ({ id: r.id, docType: r.docType, displayNumber: r.serverNumber ?? r.localNumber ?? '(borrador)', customerName: r.customerName, total: r.total, currencyId: r.currencyId, localStatus: r.localStatus, serverStatus: r.serverStatus, updatedAt: r.updatedAt }));
}

export function deleteDraft(db: AppDb, id: string) {
  db.transaction((tx) => {
    const t = tx as AppDb;
    const d = t.select().from(salesDocuments).where(eq(salesDocuments.id, id)).get();
    if (!d || d.localStatus !== 'DRAFT') throw new DocumentError('Solo se eliminan borradores', 'NOT_EDITABLE');
    t.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, id)).run();
    t.delete(salesDocuments).where(eq(salesDocuments.id, id)).run();
  });
}

/** Copia un documento como borrador nuevo (mismas líneas y cantidades; los precios se vuelven a resolver al abrirlo). */
export function duplicateDocument(db: AppDb, id: string, now = new Date()): string {
  const v = getDocument(db, id);
  if (!v) throw new DocumentError('Documento no encontrado', 'NOT_FOUND');
  return saveDraft(db, {
    docType: v.doc.docType as DocType, customerId: v.doc.customerId, currencyId: v.doc.currencyId, paymentCondition: v.doc.paymentCondition as 'CASH' | 'CREDIT', creditDays: v.doc.creditDays,
    validUntil: null, notes: v.doc.notes, warehouseId: v.doc.warehouseId,
    lines: v.lines.map((l) => ({ productId: l.productId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId, taxRate: l.taxRate })),
  }, now);
}

/**
 * «Guardar y enviar»: confirma el documento localmente (número provisional, estado PENDING_SYNC) y encola la operación en la
 * MISMA transacción: `sales_quote.create` (crea y envía) o `sales_order.create` (crea y CONFIRMA en el servidor, con reserva).
 * Si ya había una operación pendiente del mismo documento, se reemplaza su contenido (coalescencia).
 */
export function submitDocument(db: AppDb, id: string, now = new Date()): DocRow {
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const doc = t.select().from(salesDocuments).where(eq(salesDocuments.id, id)).get();
    if (!doc) throw new DocumentError('Documento no encontrado', 'NOT_FOUND');
    if (!isEditable(doc)) throw new DocumentError('El documento ya se envió', 'NOT_EDITABLE');
    if (doc.docType !== 'QUOTE' && doc.docType !== 'ORDER') throw new DocumentError('Tipo de documento no soportado', 'INVALID');
    const lines = t.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, id)).all();
    if (!lines.length) throw new DocumentError('El documento no tiene líneas', 'INVALID');
    const settings = getAppSettings(t);
    const number = doc.localNumber ?? nextLocalNumber(t);
    const row = t.update(salesDocuments).set({ localNumber: number, localStatus: 'PENDING_SYNC', syncError: null, updatedAt: now.toISOString() }).where(eq(salesDocuments.id, id)).returning().get();
    const isOrder = doc.docType === 'ORDER';
    enqueue(t, {
      entity: isOrder ? 'sales_order' : 'sales_quote', action: 'create', entityId: id, now,
      payload: {
        customerId: doc.customerId, currencyId: doc.currencyId, warehouseId: doc.warehouseId ?? settings.defaultWarehouseId, paymentCondition: doc.paymentCondition, creditDays: doc.creditDays,
        notes: doc.notes,
        ...(isOrder ? (doc.sourceDocumentId ? { sourceQuoteId: doc.sourceDocumentId } : {}) : { validUntil: doc.validUntil, send: true }),
        // Sin permiso para editar precios, el servidor fija el precio (lista vigente): no se envía.
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, discountPct: l.discountPct, description: l.description, ...(settings.allowPriceEdit ? { unitPrice: l.unitPrice } : {}) })),
      },
    });
    return row;
  });
}

/** Pedido ya generado a partir de una cotización (si existe). */
export function convertedTo(db: AppDb, quoteId: string): DocRow | undefined {
  return db.select().from(salesDocuments).where(and(eq(salesDocuments.sourceDocumentId, quoteId), eq(salesDocuments.docType, 'ORDER'))).get();
}

export interface ConversionResult { orderId: string; existing: boolean; /** la cotización estaba vencida: el pedido se crea SIN vínculo y con precios actualizados */ expired: boolean; repriced: boolean }

/**
 * Cotización → pedido (plan §9.4): abre un BORRADOR de pedido con las líneas copiadas y `source_document_id`. Si la cotización venció
 * (`validUntil` < hoy) el servidor no la convierte: el pedido se crea sin vínculo y se revalidan los precios con la lista vigente.
 * Sin permiso para editar precios, los precios siempre se re-resuelven con la lista del cliente.
 */
export function convertQuoteToOrder(db: AppDb, quoteId: string, now = new Date()): ConversionResult {
  const v = getDocument(db, quoteId);
  if (!v || v.doc.docType !== 'QUOTE') throw new DocumentError('Cotización no encontrada', 'NOT_FOUND');
  if (v.doc.localStatus === 'REJECTED') throw new DocumentError('La cotización fue rechazada por el servidor: corríjala antes de convertirla', 'INVALID');
  if (['REJECTED', 'EXPIRED'].includes(v.doc.serverStatus ?? '')) throw new DocumentError('La cotización está rechazada o vencida en el servidor', 'INVALID');
  const prior = convertedTo(db, quoteId);
  if (prior) return { orderId: prior.id, existing: true, expired: false, repriced: false };

  const today = caracasToday(now);
  const expired = !!v.doc.validUntil && v.doc.validUntil < today;
  const settings = getAppSettings(db);
  const list = priceListFor(db, v.doc.customerId);
  let repriced = false;
  const lines = v.lines.map((l) => {
    const fresh = expired || !settings.allowPriceEdit ? priceOf(db, l.productId, list?.id ?? null, today) : null;
    if (fresh !== null && fresh !== l.unitPrice) repriced = true;
    return { productId: l.productId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: fresh ?? l.unitPrice, discountPct: l.discountPct, taxId: l.taxId, taxRate: l.taxRate };
  });
  const orderId = saveDraft(db, {
    docType: 'ORDER', customerId: v.doc.customerId, currencyId: v.doc.currencyId, paymentCondition: v.doc.paymentCondition as 'CASH' | 'CREDIT', creditDays: v.doc.creditDays,
    validUntil: null, notes: expired ? `Basado en la cotización ${v.displayNumber} (vencida)${v.doc.notes ? ` · ${v.doc.notes}` : ''}` : v.doc.notes, warehouseId: v.doc.warehouseId,
    sourceDocumentId: expired ? null : quoteId, lines,
  }, now);
  return { orderId, existing: false, expired, repriced };
}

/** Fecha de vencimiento por omisión de una cotización: hoy + 15 días (hora de Caracas). */
export function defaultValidUntil(now = new Date(), days = 15): string {
  const d = new Date(`${caracasToday(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function countByStatus(db: AppDb): Record<string, number> {
  const rows = db.select({ s: salesDocuments.localStatus, n: sql<number>`count(*)` }).from(salesDocuments).where(inArray(salesDocuments.docType, ['QUOTE', 'ORDER'])).groupBy(salesDocuments.localStatus).all();
  return Object.fromEntries(rows.map((r) => [r.s, r.n]));
}

