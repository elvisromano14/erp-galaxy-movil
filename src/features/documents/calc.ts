import { calcDocument, toBase } from '../../vendor/erp-domain';

export interface CalcLine { quantity: string; unitPrice: string; discountPct: string; taxRate: string; taxExempt: boolean }

export interface DocTotals { subtotal: string; taxTotal: string; total: string; lines: { net: string; tax: string; total: string }[]; byRate: { taxRate: string; base: string; tax: string }[] }

/** Totales con el MISMO código que el servidor (decimal.js, impuesto por línea, redondeo half-up a 4 decimales). */
export function computeTotals(lines: CalcLine[]): DocTotals {
  const t = calcDocument(lines.map((l) => ({ quantity: l.quantity || '0', unitPrice: l.unitPrice || '0', discountPct: l.discountPct || '0', taxRate: l.taxRate || '0', taxExempt: l.taxExempt })));
  return {
    subtotal: t.subtotal.toFixed(4), taxTotal: t.taxTotal.toFixed(4), total: t.total.toFixed(4),
    lines: t.lines.map((l) => ({ net: l.net.toFixed(4), tax: l.tax.toFixed(4), total: l.total.toFixed(4) })),
    byRate: t.byRate.map((g) => ({ taxRate: g.taxRate.toString(), base: g.base.toFixed(4), tax: g.tax.toFixed(4) })),
  };
}

/** Equivalente en bolívares con la tasa indicada. */
export const toBs = (amount: string, rate: string) => toBase(amount, rate).toFixed(2);
