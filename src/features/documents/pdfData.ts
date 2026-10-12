import { getAppSettings } from '../../db/repositories/settings';
import type { DocumentView } from '../../db/repositories/documents';
import type { AppDb } from '../../db/types';
import { sql } from 'drizzle-orm';
import { computeTotals, toBs } from './calc';
import type { PdfData } from './pdfHtml';
import { currencyOf, latestRate } from './pricing';

/** Datos del PDF a partir del documento local: totales recalculados con el dominio compartido y equivalente en Bs con la última tasa. */
export function buildPdfData(db: AppDb, v: DocumentView): PdfData {
  const settings = getAppSettings(db);
  const cur = currencyOf(db, v.doc.currencyId) ?? { symbol: '$', decimals: 2, code: '' };
  const customer = db.all<{ legalName: string; rif: string; phone: string | null; address: string | null }>(sql`SELECT legal_name AS legalName, rif, phone, address FROM customers WHERE id = ${v.doc.customerId}`)[0] ?? null;
  const calc = computeTotals(v.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, taxExempt: Number(l.taxRate) === 0 })));
  const rate = latestRate(db, v.doc.currencyId);
  const names = new Map(db.all<{ id: string; name: string }>(sql`SELECT id, name FROM products`).map((p) => [p.id, p.name]));
  return {
    kind: v.doc.docType === 'ORDER' ? 'PEDIDO' : 'COTIZACIÓN', number: v.displayNumber, provisional: !v.doc.serverNumber,
    date: v.doc.createdAtDevice.slice(0, 10), validUntil: v.doc.validUntil,
    company: settings.company ? { legalName: settings.company.legalName, tradeName: settings.company.tradeName, rif: settings.company.rif } : null,
    seller: settings.seller?.name ?? null, customer, currency: cur,
    lines: v.lines.map((l, i) => ({ sku: l.sku, name: l.description || names.get(l.productId) || l.sku || '', quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, net: calc.lines[i].net })),
    totals: { subtotal: calc.subtotal, taxTotal: calc.taxTotal, total: calc.total, byRate: calc.byRate },
    bs: rate && cur.code !== 'VES' ? { total: toBs(calc.total, rate.rate), rate: rate.rate, rateDate: rate.date } : null,
    paymentCondition: v.doc.paymentCondition as 'CASH' | 'CREDIT', creditDays: v.doc.creditDays, notes: v.doc.notes,
  };
}
