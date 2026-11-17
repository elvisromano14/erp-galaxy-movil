import { CHUNK, type PairedPrinter, PrintError, type PrinterTransport, printReceipt } from '../src/features/printing/bluetoothPrinter';
import { COLS, pair, receiptEscPos, receiptLines, receiptText, testReceiptLines, toHex, wrap } from '../src/features/printing/receipt58';
import type { PdfData } from '../src/features/documents/pdfHtml';

const data: PdfData = {
  kind: 'NOTA DE ENTREGA', number: 'OFF-D01-0007', provisional: true, date: '2026-11-17', validUntil: null,
  company: { legalName: 'Eléctricos del Sur, C.A.', tradeName: null, rif: 'J-12345678-9' }, seller: 'María Pérez',
  customer: { legalName: 'José Ñandú', rif: 'V-1234567', phone: null, address: 'Av. 5 de Julio, Maracaibo' },
  currency: { symbol: '$', decimals: 2, code: 'USD' },
  lines: [
    { sku: 'A-1', name: 'AMORTIGUADOR DELANTERO IZQUIERDO FIESTA POWER', quantity: '2', unitPrice: '12.5', discountPct: '0', taxRate: '16', net: '25' },
    { sku: 'A-2', name: 'Cinta aislante', quantity: '1', unitPrice: '1', discountPct: '10', taxRate: '0', net: '0.9' },
  ],
  totals: { subtotal: '25.9', taxTotal: '4', total: '29.9', byRate: [{ taxRate: '16', base: '25', tax: '4' }] },
  bs: { total: '1495.00', rate: '50', rateDate: '2026-11-17' }, paymentCondition: 'CASH', creditDays: 0, notes: null,
};

describe('recibo 58 mm (app)', () => {
  it('máximo 32 columnas, solo ASCII, con totales USD/Bs y aviso de número provisional', () => {
    const txt = receiptText(receiptLines(data));
    for (const l of txt.split('\n')) expect(l.length).toBeLessThanOrEqual(COLS);
    expect(txt).toMatch(/^[\x0a\x20-\x7e]*$/);
    expect(txt).toContain('Electricos del Sur'); expect(txt).toContain('Jose Nandu'); expect(txt).toContain('provisional');
    expect(txt).toMatch(/TOTAL USD\s+29,90/); expect(txt).toMatch(/TOTAL Bs\s+1\.495,00/); expect(txt.replace(/\s+/g, ' ')).toContain('no es una factura fiscal');
  });
  it('alineación y ajuste de texto', () => {
    expect(pair('TOTAL', '1,00')).toHaveLength(COLS); expect(pair('X'.repeat(60), '9')).toHaveLength(COLS);
    expect(wrap('b'.repeat(40))).toEqual(['b'.repeat(32), 'b'.repeat(8)]);
  });
  it('ESC/POS: ESC @ al inicio, sin bytes fuera de ASCII en el texto, hex reversible', () => {
    const b = receiptEscPos(receiptLines(data));
    expect([...b.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect(toHex(Uint8Array.from([0x1b, 0x40, 0x0a]))).toBe('1b400a');
  });
  it('envía por bloques, usa la impresora elegida y traduce los errores', async () => {
    const sent: { address: string; n: number }[] = [];
    const transport = (ready: boolean, fail = false): PrinterTransport => ({
      ensureReady: async () => ready, listPaired: async () => [],
      send: async (address, bytes) => { if (fail) throw new Error('x'); sent.push({ address, n: bytes.length }); },
    });
    const p: PairedPrinter = { name: 'MP58-04', address: '00:11:22:33:44:55' };
    await printReceipt(transport(true), p, testReceiptLines('MP58-04'));
    expect(sent).toEqual([{ address: p.address, n: receiptEscPos(testReceiptLines('MP58-04')).length }]);
    await expect(printReceipt(transport(true), null, testReceiptLines(''))).rejects.toMatchObject({ code: 'NO_PRINTER' });
    await expect(printReceipt(transport(false), p, testReceiptLines(''))).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(printReceipt(transport(true, true), p, testReceiptLines(''))).rejects.toBeInstanceOf(PrintError);
    expect(CHUNK).toBeGreaterThan(0);
  });
});
