import { Decimal } from 'decimal.js';
import { Decimal as D } from '../../vendor/erp-domain';
import type { DraftInput } from '../../db/repositories/documents';
import type { AppSettings } from '../../db/repositories/settings';
import { productForLine } from './pricing';
import type { AppDb } from '../../db/types';

export interface Validation { errors: string[]; warnings: string[] }

export interface ValidateCtx {
  db: AppDb; settings: AppSettings; input: DraftInput;
  /** Crédito disponible indicativo del cliente (Bs) y total del documento en Bs, si se conocen. */
  availableCreditBs: string | null; totalBs: string | null;
  /** Antigüedad (días) de la tasa de cambio local; null si no hay tasa. */
  rateAgeDays: number | null; maxRateAgeDays?: number;
}

/**
 * Validaciones del plan §9.3: BLOQUEANTES (sin cliente, sin líneas, cantidad ≤ 0, descuento fuera del límite del vendedor, producto inactivo)
 * y AVISOS no bloqueantes (existencia, crédito, tasa antigua). El servidor vuelve a validar y manda.
 */
export function validateDocument(c: ValidateCtx): Validation {
  const errors: string[] = []; const warnings: string[] = [];
  const { input, settings } = c;
  if (!input.customerId) errors.push('Seleccione un cliente');
  if (input.lines.length === 0) errors.push('Agregue al menos un producto');
  for (const [i, l] of input.lines.entries()) {
    const n = `Línea ${i + 1} (${l.sku ?? l.productId})`;
    const qty = new Decimal(l.quantity || '0');
    if (!qty.gt(0)) errors.push(`${n}: la cantidad debe ser mayor que cero`);
    const disc = Number(l.discountPct || 0);
    if (disc < 0 || disc > 100) errors.push(`${n}: el descuento debe estar entre 0 y 100`);
    else if (disc > settings.maxDiscountPct) errors.push(`${n}: el descuento ${disc} % excede el máximo permitido (${settings.maxDiscountPct} %)`);
    if (new Decimal(l.unitPrice || '0').lt(0)) errors.push(`${n}: el precio no puede ser negativo`);
    const p = productForLine(c.db, l.productId);
    if (!p) errors.push(`${n}: el producto ya no está en el catálogo del teléfono`);
    else if (!p.isActive) errors.push(`${n}: el producto está inactivo`);
    else if (!p.isService && qty.gt(0) && qty.gt(p.available)) warnings.push(`${n}: pide ${qty.toString()} y hay ${Math.max(0, Math.round(p.available * 10000) / 10000)} disponibles (el servidor decide)`);
    if (!Number(l.unitPrice) && p && !p.isService) warnings.push(`${n}: no tiene precio en la lista del cliente`);
  }
  if (input.paymentCondition === 'CREDIT' && c.availableCreditBs !== null && c.totalBs !== null && D(c.totalBs).gt(c.availableCreditBs)) {
    warnings.push(`El total (Bs ${c.totalBs}) supera el crédito disponible del cliente (Bs ${c.availableCreditBs}); el servidor lo valida al confirmar un pedido`);
  }
  if (c.rateAgeDays === null) warnings.push('No hay tasa de cambio descargada: el equivalente en bolívares no está disponible');
  else if (c.rateAgeDays > (c.maxRateAgeDays ?? 3)) warnings.push(`La tasa de cambio tiene ${c.rateAgeDays} días: sincronice para actualizarla`);
  return { errors, warnings };
}
