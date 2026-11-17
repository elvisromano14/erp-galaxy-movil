import { formatNumber, formatQty } from '../../core/format';
import type { PdfData } from '../documents/pdfHtml';

/**
 * Recibo para impresora térmica Bluetooth de 58 mm (MP58-04 y similares: 384 puntos, 32 columnas en fuente A).
 * Mismo diseño que el recibo del ERP web (apps/api/src/modules/sales/receipt58.ts): se arma localmente, sin conexión.
 * Los acentos se pasan a ASCII para no depender de la tabla de caracteres de cada impresora.
 */
export const COLS = 32;

export interface ReceiptLine { text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean; rule?: boolean; feed?: boolean }

export const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '?');
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Parte un texto en líneas de `width` caracteres sin cortar palabras (corta las más largas que el ancho). */
export function wrap(text: string, width = COLS): string[] {
  const out: string[] = [];
  for (const para of ascii(text).split(/\r?\n/)) {
    let line = '';
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (w.length > width) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w; else if (line.length + 1 + w.length <= width) line += ` ${w}`; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** «etiqueta ........ valor» en exactamente `width` columnas (la etiqueta se recorta si no cabe). */
export function pair(label: string, value: string, width = COLS): string {
  const l = ascii(label), v = ascii(value);
  const room = width - v.length - 1;
  return `${l.length > room ? l.slice(0, Math.max(room, 0)) : l.padEnd(room)} ${v}`.slice(0, width);
}

/**
 * Líneas del recibo de una nota de entrega o cotización (documento local). Es un comprobante interno, no una factura fiscal.
 * Si el número es provisional (`OFF-…`) se advierte: el definitivo lo asigna el servidor al sincronizar.
 */
export function receiptLines(d: PdfData): ReceiptLine[] {
  const L: ReceiptLine[] = [];
  const add = (text: string, o: Omit<ReceiptLine, 'text'> = {}) => L.push({ text, ...o });
  const wrapAdd = (text: string, o: Omit<ReceiptLine, 'text'> = {}) => wrap(text).forEach((t) => add(t, o));
  const rule = () => L.push({ text: '-'.repeat(COLS), rule: true });
  const n = (v: string, dp = 2) => formatNumber(v, dp);
  const kind = d.kind === 'NOTA DE ENTREGA' ? 'NOTA DE ENTREGA' : 'COTIZACION';

  wrap(d.company?.tradeName ?? d.company?.legalName ?? 'Empresa').forEach((t) => add(t, { align: 'center', bold: true, big: true }));
  if (d.company) add(`RIF: ${d.company.rif}`, { align: 'center' });
  rule();
  add(`${kind} ${d.number}`, { align: 'center', bold: true });
  if (d.provisional) wrapAdd('Numero provisional: el definitivo se asigna al sincronizar', { align: 'center' });
  add(pair('Fecha:', day(d.date)));
  if (d.validUntil) add(pair('Valida hasta:', day(d.validUntil)));
  wrapAdd(`Cliente: ${d.customer?.legalName ?? '-'}`);
  if (d.customer) add(`RIF: ${d.customer.rif}`);
  if (d.customer?.address) wrapAdd(`Dir: ${d.customer.address}`);
  add(pair('Condicion:', d.paymentCondition === 'CREDIT' ? `Credito ${d.creditDays} dias` : 'Contado'));
  if (d.seller) add(pair('Vendedor:', d.seller));
  rule();

  for (const l of d.lines) {
    wrapAdd(`${l.name}${Number(l.taxRate) === 0 ? ' (E)' : ''}`, { bold: true });
    if (l.brand) wrapAdd(`Marca: ${l.brand}`);
    add(pair(`${formatQty(l.quantity)} x ${n(l.unitPrice)}${Number(l.discountPct) ? ` -${n(l.discountPct, 0)}%` : ''}`, n(l.net)));
  }
  rule();

  add(pair('Subtotal', n(d.totals.subtotal)));
  for (const g of d.totals.byRate) add(pair(`IVA ${n(g.taxRate, 0)}%`, n(g.tax)));
  add(pair(`TOTAL ${d.currency.code || d.currency.symbol}`, n(d.totals.total)), { bold: true, big: true });
  if (d.bs) { add(pair('Tasa', n(d.bs.rate, 4))); add(pair('TOTAL Bs', n(d.bs.total)), { bold: true }); }
  if (d.notes) { rule(); wrapAdd(`Obs: ${d.notes}`); }
  rule();
  wrapAdd('Comprobante interno, no es una factura fiscal.', { align: 'center' });
  add('Gracias por su compra', { align: 'center', bold: true });
  L.push({ text: '', feed: true });
  return L;
}

/** Texto plano de 32 columnas (vista previa en pantalla). */
export function receiptText(lines: ReceiptLine[]): string {
  return lines.map((l) => {
    const t = l.text.slice(0, COLS);
    return l.align === 'center' ? t.padStart(Math.floor((COLS + t.length) / 2)) : l.align === 'right' ? t.padStart(COLS) : t;
  }).join('\n') + '\n';
}

/** Bytes ESC/POS: ESC @ (reset), alineación, negrita, doble alto (GS ! 0x01), avance de papel. Sin tabla de caracteres: solo ASCII. */
export function receiptEscPos(lines: ReceiptLine[]): Uint8Array {
  const out: number[] = [0x1b, 0x40];
  let align = -1, bold = false, big = false;
  for (const l of lines) {
    const a = l.align === 'center' ? 1 : l.align === 'right' ? 2 : 0;
    if (a !== align) { out.push(0x1b, 0x61, a); align = a; }
    const b = !!l.bold; if (b !== bold) { out.push(0x1b, 0x45, b ? 1 : 0); bold = b; }
    const g = !!l.big; if (g !== big) { out.push(0x1d, 0x21, g ? 0x01 : 0x00); big = g; } // doble alto sin doble ancho: se conservan las 32 columnas
    if (l.feed) { out.push(0x0a, 0x0a, 0x0a); continue; }
    for (let i = 0; i < Math.min(l.text.length, COLS); i++) out.push(l.text.charCodeAt(i) & 0x7f);
    out.push(0x0a);
  }
  out.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0);
  return Uint8Array.from(out);
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Recibo de prueba para verificar el emparejamiento y el ancho (32 columnas). */
export function testReceiptLines(printerName: string): ReceiptLine[] {
  return [
    { text: 'PRUEBA DE IMPRESION', align: 'center', bold: true, big: true },
    { text: printerName.length ? ascii(printerName).slice(0, COLS) : 'Impresora 58 mm', align: 'center' },
    { text: '-'.repeat(COLS), rule: true },
    { text: '12345678901234567890123456789012' },
    { text: pair('TOTAL USD', '1.234,56'), bold: true },
    { text: '-'.repeat(COLS), rule: true },
    { text: 'Si ve esto completo, esta lista', align: 'center' },
    { text: '', feed: true },
  ];
}
