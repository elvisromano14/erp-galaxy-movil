import { Decimal } from 'decimal.js';

/** Formato venezolano: miles con punto y decimales con coma. Sin `Intl` (Hermes lo soporta solo en parte). */
function group(intPart: string) { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

export function formatNumber(value: Decimal.Value, decimals = 2): string {
  const [i, f] = new Decimal(value).toFixed(decimals).split('.');
  const neg = i.startsWith('-');
  return `${neg ? '-' : ''}${group(neg ? i.slice(1) : i)}${f ? `,${f}` : ''}`;
}

export interface CurrencyLike { symbol: string; decimals: number; code?: string }

export const formatMoney = (value: Decimal.Value, c: CurrencyLike | null | undefined) => `${c?.symbol ?? ''}${c ? ' ' : ''}${formatNumber(value, c?.decimals ?? 2)}`.trim();

/** Cantidad: hasta 4 decimales sin ceros sobrantes (`10`, `2,5`). */
export function formatQty(value: Decimal.Value): string {
  const s = new Decimal(value).toFixed(4).replace(/\.?0+$/, '');
  return formatNumber(s, s.includes('.') ? s.split('.')[1].length : 0);
}

/** «hace 5 min», «hace 3 h», «hace 2 días» (para la antigüedad de las existencias sincronizadas). */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'sin datos';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'hace instantes';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86_400);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** Fecha de hoy en Caracas (AAAA-MM-DD): la que usa el servidor para la vigencia de precios e impuestos. */
export const caracasToday = (now = new Date()) => new Date(now.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
