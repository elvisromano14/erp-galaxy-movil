import { formatMoney, formatNumber, formatQty } from '../../core/format';

export interface PdfData {
  kind: 'COTIZACIÓN' | 'PEDIDO';
  number: string; provisional: boolean;
  date: string; validUntil: string | null;
  company: { legalName: string; tradeName: string | null; rif: string } | null;
  seller: string | null;
  customer: { legalName: string; rif: string; phone: string | null; address: string | null } | null;
  currency: { symbol: string; decimals: number; code: string };
  lines: { sku: string | null; name: string; quantity: string; unitPrice: string; discountPct: string; taxRate: string; net: string }[];
  totals: { subtotal: string; taxTotal: string; total: string; byRate: { taxRate: string; base: string; tax: string }[] };
  /** Equivalente en Bs con la tasa indicada (informativo). */
  bs: { total: string; rate: string; rateDate: string } | null;
  paymentCondition: 'CASH' | 'CREDIT'; creditDays: number; notes: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * HTML de la cotización para `expo-print` (PDF compartible, p. ej. por WhatsApp). Todo el texto del usuario se escapa.
 * Si el número es provisional (`OFF-…`) se advierte: el definitivo lo asigna el servidor al sincronizar.
 */
export function buildDocumentHtml(d: PdfData): string {
  const m = (v: string) => esc(formatMoney(v, d.currency));
  const rows = d.lines.map((l) => `
    <tr><td>${esc(l.sku ?? '')}</td><td>${esc(l.name)}</td><td class="r">${esc(formatQty(l.quantity))}</td><td class="r">${m(l.unitPrice)}</td>
    <td class="r">${Number(l.discountPct) ? esc(formatNumber(l.discountPct, 2)) + ' %' : ''}</td><td class="r">${Number(l.taxRate) ? esc(formatNumber(l.taxRate, 0)) + ' %' : 'Exento'}</td><td class="r">${m(l.net)}</td></tr>`).join('');
  const taxes = d.totals.byRate.map((g) => `<tr><td>IVA ${esc(formatNumber(g.taxRate, 0))} % (base ${m(g.base)})</td><td class="r">${m(g.tax)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#101828;margin:24px}
  h1{font-size:20px;margin:0}.muted{color:#667085}.r{text-align:right}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:6px 4px;border-bottom:1px solid #e4e7ec;vertical-align:top}th{text-align:left;background:#f2f4f7}
  .head{display:flex;justify-content:space-between;gap:16px}.box{border:1px solid #e4e7ec;border-radius:6px;padding:8px;margin-top:12px}
  .tot{width:50%;margin-left:50%}.tot td{border:0}.big td{font-size:15px;font-weight:700;border-top:2px solid #101828}
  .note{margin-top:16px;font-size:10px;color:#667085}
</style></head><body>
<div class="head">
  <div><h1>${esc(d.company?.tradeName ?? d.company?.legalName ?? 'Empresa')}</h1>
    <div class="muted">${esc(d.company?.legalName ?? '')}${d.company ? ` · RIF ${esc(d.company.rif)}` : ''}</div></div>
  <div class="r"><h1>${d.kind}</h1><div><b>N° ${esc(d.number)}</b></div>
    ${d.provisional ? '<div class="muted">Número provisional: el definitivo se asigna al sincronizar</div>' : ''}
    <div>Fecha: ${esc(day(d.date))}</div>${d.validUntil ? `<div>Válida hasta: ${esc(day(d.validUntil))}</div>` : ''}</div>
</div>
<div class="box"><b>Cliente:</b> ${esc(d.customer?.legalName ?? '—')}${d.customer ? ` · RIF ${esc(d.customer.rif)}` : ''}
  ${d.customer?.phone ? `<br>Teléfono: ${esc(d.customer.phone)}` : ''}${d.customer?.address ? `<br>${esc(d.customer.address)}` : ''}
  ${d.seller ? `<br><span class="muted">Vendedor: ${esc(d.seller)}</span>` : ''}</div>
<table><thead><tr><th>Código</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Desc.</th><th class="r">IVA</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td class="r">${m(d.totals.subtotal)}</td></tr>${taxes}
  <tr class="big"><td>TOTAL ${esc(d.currency.code)}</td><td class="r">${m(d.totals.total)}</td></tr>
  ${d.bs ? `<tr><td class="muted">≈ Bs a tasa ${esc(formatNumber(d.bs.rate, 2))} (${esc(day(d.bs.rateDate))})</td><td class="r">${esc(formatMoney(d.bs.total, { symbol: 'Bs', decimals: 2 }))}</td></tr>` : ''}</table>
<div class="box">Condición: ${d.paymentCondition === 'CREDIT' ? `Crédito ${d.creditDays} días` : 'Contado'}${d.notes ? `<br>Observaciones: ${esc(d.notes)}` : ''}</div>
<div class="note">Documento no fiscal. Cotización sujeta a disponibilidad de existencias y a la validez indicada; los precios no incluyen otros impuestos que los discriminados.</div>
</body></html>`;
}
