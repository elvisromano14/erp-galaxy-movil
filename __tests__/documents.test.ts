import { eq } from 'drizzle-orm';
import { ApiClient } from '../src/core/api/ApiClient';
import { type DraftInput, DocumentError, defaultValidUntil, deleteDraft, duplicateDocument, getDocument, isEditable, listDocuments, saveDraft, submitDocument } from '../src/db/repositories/documents';
import { getAppSettings } from '../src/db/repositories/settings';
import { outbox, salesDocuments } from '../src/db/schema';
import { computeTotals, toBs } from '../src/features/documents/calc';
import { buildDocumentHtml } from '../src/features/documents/pdfHtml';
import { currencyOf, latestRate, priceListFor, priceOf, productForLine } from '../src/features/documents/pricing';
import { validateDocument } from '../src/features/documents/validate';
import { defaultHandlers } from '../src/sync/handlers';
import { SyncEngine } from '../src/sync/SyncEngine';
import { TODAY, seedCatalog } from './catalog';
import { fakeFetch, memoryTokens } from './helpers';

const line = (productId: string, quantity: string, unitPrice: string, extra: object = {}) =>
  ({ productId, sku: productId.toUpperCase(), description: null, quantity, unitPrice, discountPct: '0', taxId: 't16', taxRate: '16', ...extra });
const draft = (lines: DraftInput['lines'], extra: Partial<DraftInput> = {}): DraftInput => ({ docType: 'QUOTE', customerId: 'c1', currencyId: 'usd', paymentCondition: 'CASH', creditDays: 0, validUntil: '2026-10-26', notes: null, warehouseId: 'w1', lines, ...extra });

describe('totales (mismo código que el servidor)', () => {
  it('caso dorado del ERP: 2×20 −5 % + 3×10, IVA 16 % → subtotal 68, IVA 10,88, total 78,88', () => {
    const t = computeTotals([
      { quantity: '2', unitPrice: '20', discountPct: '5', taxRate: '16', taxExempt: false },
      { quantity: '3', unitPrice: '10', discountPct: '0', taxRate: '16', taxExempt: false },
    ]);
    expect(t).toMatchObject({ subtotal: '68.0000', taxTotal: '10.8800', total: '78.8800' });
    expect(t.lines[0]).toMatchObject({ net: '38.0000', tax: '6.0800' });
    expect(toBs(t.total, '40')).toBe('3155.20');
  });
  it('exentos sin IVA y agrupación por alícuota', () => {
    const t = computeTotals([{ quantity: '1', unitPrice: '100', discountPct: '0', taxRate: '16', taxExempt: false }, { quantity: '2', unitPrice: '5', discountPct: '0', taxRate: '0', taxExempt: true }]);
    expect(t).toMatchObject({ subtotal: '110.0000', taxTotal: '16.0000', total: '126.0000' });
    expect(t.byRate).toEqual([{ taxRate: '16', base: '100.0000', tax: '16.0000' }]);
  });
});

describe('precios y datos locales', () => {
  it('lista del cliente o por omisión, precio vigente, impuesto, moneda y tasa', async () => {
    const db = await seedCatalog();
    expect(priceListFor(db, 'c1')).toMatchObject({ id: 'L1', currencyId: 'usd' });
    expect(priceOf(db, 'p1', 'L1', TODAY)).toBe('20'); expect(priceOf(db, 'p1', 'L1', '2025-01-01')).toBeNull(); expect(priceOf(db, 'p1', null, TODAY)).toBeNull();
    expect(productForLine(db, 'p1')).toMatchObject({ taxRate: '16', taxExempt: false, available: 8 });
    expect(productForLine(db, 'p3')).toMatchObject({ taxRate: '0', taxExempt: true });
    expect(currencyOf(db, 'usd')).toMatchObject({ code: 'USD', symbol: '$' });
    expect(latestRate(db, 'usd')).toMatchObject({ rate: '40', date: TODAY });
    expect(getAppSettings(db)).toMatchObject({ maxDiscountPct: 10, allowPriceEdit: false, deviceCode: 'D07', seller: { code: 'V01' } });
  });
});

describe('borradores y envío', () => {
  it('guardar borrador: documento + líneas + totales, sin tocar la cola; actualizar reemplaza las líneas', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '2', '20', { discountPct: '5' }), line('p2', '3', '10')]));
    const v = getDocument(db, id)!;
    expect(v.doc).toMatchObject({ localStatus: 'DRAFT', subtotal: '68.0000', taxTotal: '10.8800', total: '78.8800', localNumber: null }); expect(v.displayNumber).toBe('(borrador)');
    expect(v.lines).toHaveLength(2); expect(v.customerName).toBe('Repuestos El Sol, C.A.');
    expect(db.select().from(outbox).all()).toHaveLength(0);
    saveDraft(db, { ...draft([line('p1', '1', '20')]), id });
    expect(getDocument(db, id)!.lines).toHaveLength(1); expect(getDocument(db, id)!.doc.version).toBe(2);
  });

  it('guardar y enviar: número provisional OFF-D07-000001, PENDING_SYNC y UNA operación en la misma transacción', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '2', '20', { discountPct: '5' })]));
    const doc = submitDocument(db, id);
    expect(doc).toMatchObject({ localStatus: 'PENDING_SYNC', localNumber: 'OFF-D07-000001' });
    const op = db.select().from(outbox).get()!;
    expect(op).toMatchObject({ entity: 'sales_quote', action: 'create', entityId: id, status: 'PENDING' });
    const p = JSON.parse(op.payloadJson);
    expect(p).toMatchObject({ customerId: 'c1', currencyId: 'usd', warehouseId: 'w1', send: true, paymentCondition: 'CASH', validUntil: '2026-10-26' });
    expect(p.lines).toEqual([{ productId: 'p1', quantity: '2', discountPct: '5', description: null }]); // sin unitPrice: el servidor fija el precio
    // el número se conserva si se edita y reenvía; la operación pendiente se reemplaza (coalescencia)
    saveDraft(db, { ...draft([line('p1', '4', '20')]), id });
    submitDocument(db, id);
    expect(db.select().from(outbox).all()).toHaveLength(1); expect(JSON.parse(db.select().from(outbox).get()!.payloadJson).lines[0].quantity).toBe('4');
    expect(getDocument(db, id)!.doc.localNumber).toBe('OFF-D07-000001');
    // el siguiente documento recibe el siguiente número
    expect(submitDocument(db, saveDraft(db, draft([line('p2', '1', '10')]))).localNumber).toBe('OFF-D07-000002');
  });

  it('con permiso de editar precios, el precio del vendedor SÍ se envía', async () => {
    const db = await seedCatalog({ allowPriceEdit: true });
    submitDocument(db, saveDraft(db, draft([line('p1', '1', '18.5')])));
    expect(JSON.parse(db.select().from(outbox).get()!.payloadJson).lines[0].unitPrice).toBe('18.5');
  });

  it('lo ya enviado es de solo lectura; un rechazado se puede corregir y reenviar como operación nueva', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '1', '20')])); submitDocument(db, id);
    db.update(salesDocuments).set({ localStatus: 'SYNCED' }).where(eq(salesDocuments.id, id)).run();
    expect(isEditable({ localStatus: 'SYNCED' })).toBe(false);
    expect(() => saveDraft(db, { ...draft([line('p1', '2', '20')]), id })).toThrow(expect.objectContaining({ code: 'NOT_EDITABLE' }));
    expect(() => submitDocument(db, id)).toThrow(DocumentError);
    const rej = saveDraft(db, draft([line('p2', '1', '10')])); submitDocument(db, rej);
    db.update(outbox).set({ status: 'REJECTED' }).where(eq(outbox.entityId, rej)).run();
    db.update(salesDocuments).set({ localStatus: 'REJECTED' }).where(eq(salesDocuments.id, rej)).run();
    saveDraft(db, { ...draft([line('p2', '2', '10')]), id: rej }); submitDocument(db, rej);
    expect(db.select().from(outbox).all().filter((o) => o.entityId === rej).map((o) => o.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('duplicar copia líneas como borrador nuevo; eliminar solo borradores; listado con filtros', async () => {
    const db = await seedCatalog();
    const a = saveDraft(db, draft([line('p1', '2', '20')])); submitDocument(db, a);
    const copy = duplicateDocument(db, a);
    expect(getDocument(db, copy)!.doc).toMatchObject({ localStatus: 'DRAFT', localNumber: null, validUntil: null }); expect(getDocument(db, copy)!.lines[0].quantity).toBe('2');
    expect(() => deleteDraft(db, a)).toThrow(DocumentError); deleteDraft(db, copy); expect(getDocument(db, copy)).toBeNull();
    saveDraft(db, draft([line('p2', '1', '10')]));
    expect(listDocuments(db).map((d) => d.localStatus).sort()).toEqual(['DRAFT', 'PENDING_SYNC']);
    expect(listDocuments(db, { status: 'PENDING_SYNC' })[0]).toMatchObject({ displayNumber: 'OFF-D07-000001', customerName: 'Repuestos El Sol, C.A.' });
    expect(listDocuments(db, { query: 'sol' })).toHaveLength(2); expect(listDocuments(db, { query: 'zzz' })).toHaveLength(0);
  });

  it('vigencia por omisión: hoy + 15 días (Caracas)', () => {
    expect(defaultValidUntil(new Date('2026-10-12T02:00:00Z'))).toBe('2026-10-26'); // 22:00 del 11 en Caracas
  });
});

describe('validaciones', () => {
  const run = async (input: DraftInput, extra: Partial<Parameters<typeof validateDocument>[0]> = {}) => {
    const db = await seedCatalog();
    return validateDocument({ db, settings: getAppSettings(db), input, availableCreditBs: null, totalBs: null, rateAgeDays: 0, ...extra });
  };

  it('bloqueantes: sin líneas, cantidad ≤ 0, descuento sobre el máximo del vendedor, producto inactivo o desconocido', async () => {
    expect((await run(draft([]))).errors).toContain('Agregue al menos un producto');
    expect((await run(draft([line('p1', '0', '20')]))).errors.join()).toContain('cantidad debe ser mayor que cero');
    expect((await run(draft([line('p1', '1', '20', { discountPct: '15' })]))).errors.join()).toContain('excede el máximo permitido (10 %)');
    expect((await run(draft([line('p1', '1', '20', { discountPct: '10' })]))).errors).toHaveLength(0); // el límite exacto vale
    expect((await run(draft([line('p4', '1', '20')]))).errors.join()).toContain('inactivo');
    expect((await run(draft([line('zz', '1', '20')]))).errors.join()).toContain('ya no está en el catálogo');
    expect((await run({ ...draft([line('p1', '1', '20')]), customerId: '' })).errors).toContain('Seleccione un cliente');
  });

  it('avisos (no bloquean): existencia insuficiente, crédito excedido y tasa vieja o ausente', async () => {
    const v = await run({ ...draft([line('p1', '9', '20')]), paymentCondition: 'CREDIT', creditDays: 15 }, { availableCreditBs: '1000', totalBs: '7000', rateAgeDays: 5 });
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.join('|')).toContain('hay 8 disponibles'); expect(v.warnings.join('|')).toContain('supera el crédito disponible'); expect(v.warnings.join('|')).toContain('tasa de cambio tiene 5 días');
    expect((await run(draft([line('p1', '1', '20')]), { rateAgeDays: null })).warnings.join()).toContain('No hay tasa de cambio');
    expect((await run(draft([line('p3', '2', '5')]))).warnings).toHaveLength(0); // dentro de la existencia
  });
});

describe('resultado del servidor y PDF', () => {
  it('al sincronizar la cotización: número definitivo del servidor, estado SYNCED y el pull posterior lo refresca', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '2', '20', { discountPct: '5' })])); submitDocument(db, id);
    const f = fakeFetch({
      'POST /sync/push': (_u: URL, init: RequestInit) => { const [op] = JSON.parse(String(init.body)).operations; return { body: { data: { results: [{ clientOpId: op.clientOpId, status: 'APPLIED', serverId: 'q-srv', serverNumber: 'COT-V-000123', serverStatus: 'SENT' }], serverTime: 'x' } } }; },
      'GET /sync/pull': (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: true, serverTime: 'x' } } }),
    });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl });
    await new SyncEngine({ api, db, handlers: defaultHandlers }).run();
    const v = getDocument(db, id)!;
    expect(v.doc).toMatchObject({ localStatus: 'SYNCED', serverId: 'q-srv', serverNumber: 'COT-V-000123', serverStatus: 'SENT', localNumber: 'OFF-D07-000001' });
    expect(v.displayNumber).toBe('COT-V-000123'); expect(v.editable).toBe(false);
  });

  it('rechazo del servidor: el documento queda REJECTED con el motivo y editable', async () => {
    const db = await seedCatalog();
    const id = saveDraft(db, draft([line('p1', '2', '20')])); submitDocument(db, id);
    const f = fakeFetch({
      'POST /sync/push': (_u: URL, init: RequestInit) => { const [op] = JSON.parse(String(init.body)).operations; return { body: { data: { results: [{ clientOpId: op.clientOpId, status: 'REJECTED', errorCode: 'PRODUCT_INACTIVE', message: 'El producto PAS-001 está inactivo' }], serverTime: 'x' } } }; },
      'GET /sync/pull': (u: URL) => ({ body: { data: { entity: u.searchParams.get('entity'), items: [], nextCursor: null, hasMore: false, fullRefresh: true, serverTime: 'x' } } }),
    });
    await new SyncEngine({ api: new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl }), db, handlers: defaultHandlers }).run();
    const v = getDocument(db, id)!;
    expect(v.doc).toMatchObject({ localStatus: 'REJECTED' }); expect(v.lastOpError).toContain('PRODUCT_INACTIVE'); expect(v.editable).toBe(true);
  });

  it('PDF: contiene número, cliente, líneas, totales y equivalente en Bs; escapa el texto del usuario; avisa si el número es provisional', () => {
    const html = buildDocumentHtml({
      kind: 'COTIZACIÓN', number: 'OFF-D07-000001', provisional: true, date: '2026-10-11', validUntil: '2026-10-26',
      company: { legalName: 'Repuestos Galaxy, C.A.', tradeName: 'Galaxy Repuestos', rif: 'J-12345678-4' }, seller: 'Vendedor Uno',
      customer: { legalName: 'Taller <b>"El Sol"</b> & Cía', rif: 'J-30000000-1', phone: '0212-5551234', address: 'Av. Principal' },
      currency: { symbol: '$', decimals: 2, code: 'USD' },
      lines: [{ sku: 'PAS-001', name: 'Pastilla <script>alert(1)</script>', quantity: '2', unitPrice: '20', discountPct: '5', taxRate: '16', net: '38' }],
      totals: { subtotal: '38', taxTotal: '6.08', total: '44.08', byRate: [{ taxRate: '16', base: '38', tax: '6.08' }] },
      bs: { total: '1763.20', rate: '40', rateDate: '2026-10-11' }, paymentCondition: 'CREDIT', creditDays: 15, notes: 'Entrega en 48 h',
    });
    expect(html).toContain('N° OFF-D07-000001'); expect(html).toContain('Número provisional'); expect(html).toContain('Galaxy Repuestos');
    expect(html).toContain('$ 44,08'); expect(html).toContain('Bs 1.763,20'); expect(html).toContain('Crédito 15 días'); expect(html).toContain('26/10/2026'); expect(html).toContain('IVA 16 %');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<b>"El Sol"'); expect(html).toContain('Taller &lt;b&gt;&quot;El Sol&quot;&lt;/b&gt; &amp; Cía');
    expect(buildDocumentHtml({ kind: 'COTIZACIÓN', number: 'COT-V-1', provisional: false, date: '2026-10-11', validUntil: null, company: null, seller: null, customer: null, currency: { symbol: '$', decimals: 2, code: 'USD' }, lines: [], totals: { subtotal: '0', taxTotal: '0', total: '0', byRate: [] }, bs: null, paymentCondition: 'CASH', creditDays: 0, notes: null })).not.toContain('Número provisional');
  });
});

describe('selector (cliente / producto)', () => {
  it('lo elegido se entrega una sola vez y solo al tipo pedido', () => {
    const { pick, consumePick } = require('../src/features/documents/pickerStore');
    pick('customer', 'c1');
    expect(consumePick('product')).toBeNull(); // otro tipo: no lo consume
    expect(consumePick('customer')).toBe('c1');
    expect(consumePick('customer')).toBeNull(); // ya consumido
  });
});
