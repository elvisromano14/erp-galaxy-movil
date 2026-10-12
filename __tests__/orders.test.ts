import { eq } from 'drizzle-orm';
import { type DraftInput, DocumentError, convertQuoteToOrder, convertedTo, getDocument, saveDraft, submitDocument } from '../src/db/repositories/documents';
import { outbox, salesDocuments } from '../src/db/schema';
import { explainError, SERVER_STATUS_LABEL } from '../src/features/documents/explain';
import { buildTimeline } from '../src/features/documents/timeline';
import { TODAY, seedCatalog } from './catalog';

const line = (productId: string, quantity: string, unitPrice: string, extra: object = {}) =>
  ({ productId, sku: productId.toUpperCase(), description: null, quantity, unitPrice, discountPct: '0', taxId: 't16', taxRate: '16', ...extra });
const draft = (lines: DraftInput['lines'], extra: Partial<DraftInput> = {}): DraftInput => ({ docType: 'QUOTE', customerId: 'c1', currencyId: 'usd', paymentCondition: 'CASH', creditDays: 0, validUntil: '2026-10-26', notes: null, warehouseId: 'w1', lines, ...extra });
const NOW = new Date(`${TODAY}T15:00:00Z`);

describe('pedidos', () => {
  it('pedido desde cero: encola sales_order.create (crea y confirma en el servidor), sin validUntil ni send', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '2', '20', { discountPct: '5' })], { docType: 'ORDER', validUntil: null }), NOW);
    expect(submitDocument(db, id, NOW)).toMatchObject({ localStatus: 'PENDING_SYNC', docType: 'ORDER', localNumber: 'OFF-D07-000001' });
    const op = db.select().from(outbox).get()!; const p = JSON.parse(op.payloadJson);
    expect(op).toMatchObject({ entity: 'sales_order', action: 'create', entityId: id });
    expect(p).toMatchObject({ customerId: 'c1', currencyId: 'usd', warehouseId: 'w1', paymentCondition: 'CASH' });
    expect(p).not.toHaveProperty('send'); expect(p).not.toHaveProperty('validUntil'); expect(p).not.toHaveProperty('sourceQuoteId');
  });

  it('cotización → pedido: borrador con las líneas y vínculo; al enviar viaja sourceQuoteId; no se duplica la conversión', async () => {
    const db = await seedCatalog();
    const q = saveDraft(db, draft([line('p1', '2', '20', { discountPct: '5' }), line('p2', '3', '10')]), NOW); submitDocument(db, q, NOW);
    const conv = convertQuoteToOrder(db, q, NOW);
    expect(conv).toMatchObject({ existing: false, expired: false, repriced: false });
    const o = getDocument(db, conv.orderId)!;
    expect(o.doc).toMatchObject({ docType: 'ORDER', localStatus: 'DRAFT', sourceDocumentId: q, customerId: 'c1', total: '78.8800' });
    expect(o.lines.map((l) => `${l.productId}:${l.quantity}:${l.discountPct}`)).toEqual(['p1:2:5', 'p2:3:0']);
    submitDocument(db, conv.orderId, NOW);
    const op = db.select().from(outbox).all().find((x) => x.entity === 'sales_order')!;
    expect(JSON.parse(op.payloadJson).sourceQuoteId).toBe(q);
    expect(op.clientSeq).toBeGreaterThan(db.select().from(outbox).all().find((x) => x.entity === 'sales_quote')!.clientSeq); // la cotización sale antes
    expect(convertedTo(db, q)?.id).toBe(conv.orderId);
    expect(convertQuoteToOrder(db, q, NOW)).toMatchObject({ orderId: conv.orderId, existing: true });
  });

  it('cotización VENCIDA: el pedido se crea sin vínculo (el servidor no convierte vencidas) y con precios actualizados', async () => {
    const db = await seedCatalog();
    const q = saveDraft(db, draft([line('p1', '2', '12.5')], { validUntil: '2026-09-30' }), NOW); submitDocument(db, q, NOW);
    const conv = convertQuoteToOrder(db, q, NOW);
    expect(conv).toMatchObject({ expired: true, repriced: true });
    const o = getDocument(db, conv.orderId)!;
    expect(o.doc.sourceDocumentId).toBeNull(); expect(o.doc.notes).toContain('(vencida)'); expect(o.lines[0].unitPrice).toBe('20'); // precio vigente de la lista
    submitDocument(db, conv.orderId, NOW);
    expect(JSON.parse(db.select().from(outbox).all().find((x) => x.entity === 'sales_order')!.payloadJson)).not.toHaveProperty('sourceQuoteId');
  });

  it('sin permiso de editar precios, al convertir se re-resuelven con la lista; con permiso se respeta el precio pactado', async () => {
    const dbA = await seedCatalog();
    const qa = saveDraft(dbA, draft([line('p1', '1', '17')]), NOW);
    expect(convertQuoteToOrder(dbA, qa, NOW)).toMatchObject({ repriced: true });
    const dbB = await seedCatalog({ allowPriceEdit: true });
    const qb = saveDraft(dbB, draft([line('p1', '1', '17')]), NOW);
    const c = convertQuoteToOrder(dbB, qb, NOW);
    expect(c.repriced).toBe(false); expect(getDocument(dbB, c.orderId)!.lines[0].unitPrice).toBe('17');
  });

  it('no se convierte una cotización rechazada (local o en el servidor)', async () => {
    const db = await seedCatalog();
    const q = saveDraft(db, draft([line('p1', '1', '20')]), NOW);
    db.update(salesDocuments).set({ localStatus: 'REJECTED' }).where(eq(salesDocuments.id, q)).run();
    expect(() => convertQuoteToOrder(db, q, NOW)).toThrow(DocumentError);
    db.update(salesDocuments).set({ localStatus: 'SYNCED', serverStatus: 'REJECTED' }).where(eq(salesDocuments.id, q)).run();
    expect(() => convertQuoteToOrder(db, q, NOW)).toThrow(/rechazada o vencida/);
  });
});

describe('explicación de errores y línea de tiempo', () => {
  it('traduce los códigos del servidor a una instrucción comprensible', () => {
    expect(explainError('CREDIT_LIMIT_EXCEEDED: Excede el límite de crédito')).toContain('administración debe revisarlo');
    expect(explainError('DISCOUNT_NOT_ALLOWED: El descuento 15 % excede el máximo permitido (10 %)')).toContain('Reduzca el descuento');
    expect(explainError('PRODUCT_INACTIVE: El producto X está inactivo')).toContain('Quite esa línea');
    expect(explainError('ALGO_RARO: detalle del servidor')).toBe('detalle del servidor');
    expect(explainError(null)).toBe('El servidor no aceptó la operación.');
    expect(explainError('texto sin código')).toBe('texto sin código');
  });

  it('estados del servidor en español', () => {
    expect(SERVER_STATUS_LABEL).toMatchObject({ CONFIRMED: 'Confirmado', INVOICED: 'Facturado', CANCELLED: 'Anulado', SENT: 'Enviada' });
  });

  it('línea de tiempo: creado → confirmado en el teléfono → en cola → recibido → estado actual', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '1', '20')], { docType: 'ORDER', validUntil: null }), NOW); submitDocument(db, id, NOW);
    const ops = () => db.select().from(outbox).all();
    expect(buildTimeline(getDocument(db, id)!, ops()).map((e) => e.label)).toEqual(['Creado en el teléfono', 'Confirmado en el teléfono (OFF-D07-000001)', 'En cola de envío']);
    db.update(salesDocuments).set({ localStatus: 'SYNCED', serverNumber: 'PED-000009', serverStatus: 'CONFIRMED' }).where(eq(salesDocuments.id, id)).run();
    db.update(outbox).set({ status: 'DONE' }).run();
    const t = buildTimeline(getDocument(db, id)!, ops());
    expect(t.map((e) => e.label)).toEqual(['Creado en el teléfono', 'Confirmado en el teléfono (OFF-D07-000001)', 'Recibido por el servidor (PED-000009)', 'Estado actual: Confirmado']);
    db.update(salesDocuments).set({ serverStatus: 'CANCELLED' }).where(eq(salesDocuments.id, id)).run();
    expect(buildTimeline(getDocument(db, id)!, ops()).at(-1)).toMatchObject({ label: 'Estado actual: Anulado', tone: 'error' });
  });
});
