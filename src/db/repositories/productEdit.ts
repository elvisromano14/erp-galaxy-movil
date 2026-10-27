import { and, eq, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { uuidv7 } from '../../core/uuid';
import { normalizeText } from '../../sync/normalize';
import { categories, locations, productPrices, productRefs, products, taxes, units } from '../schema';
import type { AppDb } from '../types';
import { defaultPriceListId } from './products';
import { enqueue, latestForEntity, type OutboxRow } from './outbox';

export interface ProductInput {
  sku: string; name: string; description?: string | null;
  categoryId?: string | null; unitId: string; taxId?: string | null;
  /** Marca: texto libre, opcional. */
  brand?: string | null;
  /** Ubicación física (id de `locations`): opcional, no exigida. */
  locationId?: string | null;
  minStock?: string | null; maxStock?: string | null;
  isService?: boolean;
  barcodes?: string[];
  /** Precio en la lista de precios predeterminada (moneda de la lista), texto decimal. */
  price?: string | null;
}

export type ProductErrorCode =
  | 'SKU_REQUIRED' | 'SKU_TOO_LONG' | 'NAME_REQUIRED' | 'NAME_TOO_LONG' | 'UNIT_REQUIRED' | 'BRAND_TOO_LONG' | 'DESCRIPTION_TOO_LONG'
  | 'INVALID_NUMBER' | 'STOCK_RANGE' | 'TOO_MANY_BARCODES' | 'DUPLICATE_SKU' | 'DUPLICATE_BARCODE' | 'NO_PRICE_LIST' | 'NOT_FOUND' | 'NOT_EDITABLE';

/** Error de validación local (el mensaje se muestra tal cual al vendedor). */
export class ProductError extends Error {
  constructor(message: string, readonly code: ProductErrorCode, readonly existingId?: string) { super(message); this.name = 'ProductError'; }
}

const clean = (v?: string | null) => { const t = v?.trim(); return t ? t : null; };
const MAX_BARCODES = 20;

/** Decimal no negativo como texto (acepta coma decimal); null si viene vacío. */
export function parseNonNegative(v: string | null | undefined, label: string): string | null {
  const t = clean(v);
  if (t === null) return null;
  const d = (() => { try { return new Decimal(t.replace(',', '.')); } catch { return null; } })();
  if (!d || !d.isFinite() || d.isNegative()) throw new ProductError(`${label}: indique un número válido (no negativo)`, 'INVALID_NUMBER');
  return d.toFixed();
}

export interface NormalizedProduct {
  sku: string; name: string; description: string | null; categoryId: string | null; unitId: string; taxId: string | null; brand: string | null; locationId: string | null;
  minStock: string | null; maxStock: string | null; isService: boolean; barcodes: string[]; price: string | null;
}

/** Valida y normaliza con las mismas reglas del servidor (longitudes, números, rango de existencias). Pura: no toca la base. */
export function normalizeProduct(i: ProductInput): NormalizedProduct {
  const sku = (i.sku ?? '').trim();
  if (!sku) throw new ProductError('Indique el código (SKU) del producto', 'SKU_REQUIRED');
  if (sku.length > 60) throw new ProductError('El código (SKU) admite hasta 60 caracteres', 'SKU_TOO_LONG');
  const name = (i.name ?? '').trim();
  if (!name) throw new ProductError('Indique el nombre del producto', 'NAME_REQUIRED');
  if (name.length > 250) throw new ProductError('El nombre admite hasta 250 caracteres', 'NAME_TOO_LONG');
  if (!clean(i.unitId)) throw new ProductError('Elija la unidad del producto', 'UNIT_REQUIRED');
  const description = clean(i.description);
  if (description && description.length > 2000) throw new ProductError('La descripción admite hasta 2000 caracteres', 'DESCRIPTION_TOO_LONG');
  const brand = clean(i.brand);
  if (brand && brand.length > 80) throw new ProductError('La marca admite hasta 80 caracteres', 'BRAND_TOO_LONG');
  const minStock = parseNonNegative(i.minStock, 'Existencia mínima');
  const maxStock = parseNonNegative(i.maxStock, 'Existencia máxima');
  if (maxStock !== null && minStock !== null && new Decimal(maxStock).gt(0) && new Decimal(maxStock).lt(minStock)) throw new ProductError('La existencia máxima no puede ser menor que la mínima', 'STOCK_RANGE');
  const barcodes = [...new Set((i.barcodes ?? []).map((b) => b.trim()).filter(Boolean))];
  if (barcodes.length > MAX_BARCODES) throw new ProductError(`Se admiten hasta ${MAX_BARCODES} códigos de barras`, 'TOO_MANY_BARCODES');
  return {
    sku, name, description, categoryId: clean(i.categoryId), unitId: i.unitId.trim(), taxId: clean(i.taxId), brand, locationId: clean(i.locationId),
    minStock, maxStock, isService: !!i.isService, barcodes, price: parseNonNegative(i.price, 'Precio'),
  };
}

/** Carga útil de `product.create` (contrato del servidor: docs/API-MOVIL-PRODUCTOS.md). */
function createPayload(n: NormalizedProduct): Record<string, unknown> {
  return {
    sku: n.sku, name: n.name, unitId: n.unitId, categoryId: n.categoryId, taxId: n.taxId, brand: n.brand, locationId: n.locationId, description: n.description,
    isService: n.isService, ...(n.minStock !== null ? { minStock: n.minStock } : {}), ...(n.maxStock !== null ? { maxStock: n.maxStock } : {}),
    ...(n.barcodes.length ? { barcodes: n.barcodes } : {}), ...(n.price !== null ? { price: n.price } : {}),
  };
}

/** Carga útil de `product.update`: igual que el alta, sin `sku`, con la `version` que la app vio en el pull. */
function updatePayload(n: NormalizedProduct, version: number): Record<string, unknown> {
  const { sku: _sku, ...rest } = createPayload(n);
  return { ...rest, barcodes: n.barcodes, version };
}

const denormalized = (db: AppDb, n: NormalizedProduct) => {
  const cat = n.categoryId ? db.select({ name: categories.name }).from(categories).where(eq(categories.id, n.categoryId)).get() : undefined;
  const unit = db.select({ code: units.code }).from(units).where(eq(units.id, n.unitId)).get();
  return { categoryName: cat?.name ?? null, unitCode: unit?.code ?? null };
};

const searchTextOf = (n: NormalizedProduct, extra = '') => normalizeText(n.sku, n.name, n.brand, n.description, n.barcodes.join(' '), extra);

/** Sustituye los códigos de barras del producto, comprobando que no pertenezcan a otro producto. */
function setBarcodes(db: AppDb, productId: string, barcodes: string[]) {
  for (const code of barcodes) {
    const owner = db.select({ productId: productRefs.productId }).from(productRefs).where(and(eq(productRefs.kind, 'BARCODE'), eq(productRefs.code, code))).get();
    if (owner && owner.productId !== productId) {
      const p = db.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, owner.productId)).get();
      throw new ProductError(`El código de barras ${code} ya pertenece a ${p ? `${p.sku} · ${p.name}` : 'otro producto'}`, 'DUPLICATE_BARCODE', owner.productId);
    }
  }
  db.delete(productRefs).where(and(eq(productRefs.productId, productId), eq(productRefs.kind, 'BARCODE'))).run();
  for (const code of barcodes) db.insert(productRefs).values({ productId, kind: 'BARCODE', code, brand: null }).run();
}

/** Precio local provisional (id con prefijo `L-`): se ve de inmediato en listas y detalle; el pull trae el definitivo y `remapProduct` lo retira. */
function setLocalPrice(db: AppDb, productId: string, price: string | null, today: string) {
  db.delete(productPrices).where(and(eq(productPrices.productId, productId), sql`${productPrices.id} LIKE 'L-%'`)).run();
  if (price === null) return;
  const listId = defaultPriceListId(db);
  if (!listId) throw new ProductError('Aún no se ha descargado la lista de precios: sincronice antes de indicar un precio', 'NO_PRICE_LIST');
  db.insert(productPrices).values({ id: `L-${uuidv7()}`, productId, priceListId: listId, price, validFrom: today }).run();
}

export type LocalProduct = typeof products.$inferSelect;

/**
 * Alta de producto sin conexión: valida, lo guarda localmente (usable de inmediato en cotizaciones) y encola `product.create`.
 * Fila + operación en UNA transacción. El SKU no puede repetirse (sin distinguir mayúsculas).
 */
export function createProductLocal(db: AppDb, input: ProductInput, o: { now?: Date; today?: string } = {}): LocalProduct {
  const n = normalizeProduct(input);
  const now = o.now ?? new Date();
  const today = o.today ?? now.toISOString().slice(0, 10);
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const dup = t.select({ id: products.id, name: products.name }).from(products).where(sql`lower(${products.sku}) = ${n.sku.toLowerCase()}`).get();
    if (dup) throw new ProductError(`Ya existe un producto con ese código: ${dup.name}`, 'DUPLICATE_SKU', dup.id);
    const id = uuidv7(now.getTime());
    const row = t.insert(products).values({
      id, sku: n.sku, name: n.name, description: n.description, ...denormalized(t, n), taxId: n.taxId, categoryId: n.categoryId, unitId: n.unitId, brand: n.brand,
      locationId: n.locationId, minStock: n.minStock, maxStock: n.maxStock, isLocal: true, trackingMode: 'NONE', isService: n.isService, isActive: true,
      searchText: searchTextOf(n), version: 1,
    }).returning().get();
    setBarcodes(t, id, n.barcodes);
    setLocalPrice(t, id, n.price, today);
    enqueue(t, { entity: 'product', action: 'create', entityId: id, payload: createPayload(n), now });
    return row;
  });
}

/**
 * Edición de un producto (el SKU no cambia). Si el alta aún no se envió (o fue rechazada) la edición se funde en ella o se reenvía como
 * alta NUEVA; si ya está en el servidor se encola un `update` con la `version` vista. Un `update` rechazado por `VERSION_CONFLICT` se
 * corrige sincronizando (baja la versión nueva) y guardando de nuevo.
 */
export function updateProductLocal(db: AppDb, id: string, patch: Omit<ProductInput, 'sku'>, o: { now?: Date; today?: string } = {}): LocalProduct {
  const now = o.now ?? new Date();
  const today = o.today ?? now.toISOString().slice(0, 10);
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const cur = t.select().from(products).where(eq(products.id, id)).get();
    if (!cur) throw new ProductError('Producto no encontrado', 'NOT_FOUND');
    if (cur.trackingMode !== 'NONE') throw new ProductError('Los productos con lotes o seriales se editan desde la oficina', 'NOT_EDITABLE');
    const n = normalizeProduct({ ...patch, sku: cur.sku });
    const row = t.update(products).set({
      name: n.name, description: n.description, ...denormalized(t, n), taxId: n.taxId, categoryId: n.categoryId, unitId: n.unitId, brand: n.brand,
      locationId: n.locationId, minStock: n.minStock, maxStock: n.maxStock, isService: n.isService, searchText: searchTextOf(n),
    }).where(eq(products.id, id)).returning().get();
    setBarcodes(t, id, n.barcodes);
    if (n.price !== null) setLocalPrice(t, id, n.price, today);
    const last = latestForEntity(t, 'product', id);
    // Alta rechazada (o nunca enviada con éxito): se reenvía como alta NUEVA, porque el servidor no tiene esa entidad.
    const asCreate = cur.isLocal && (!last || last.status === 'REJECTED');
    enqueue(t, { entity: 'product', action: asCreate ? 'create' : 'update', entityId: id, payload: asCreate ? createPayload(n) : updatePayload(n, cur.version), now });
    return row;
  });
}

/**
 * El servidor confirmó el alta (o vinculó el SKU a un producto existente): la fila local adopta el id del servidor, o se fusiona con la que
 * ya bajó por el pull. Los códigos de barras pasan al id del servidor y el precio provisional se retira (el pull trae el definitivo).
 */
export function remapProduct(db: AppDb, localId: string, serverId: string) {
  db.transaction((tx) => {
    const t = tx as AppDb;
    const local = t.select().from(products).where(eq(products.id, localId)).get();
    if (!local) return;
    t.delete(productPrices).where(and(eq(productPrices.productId, localId), sql`${productPrices.id} LIKE 'L-%'`)).run();
    if (localId === serverId) { t.update(products).set({ isLocal: false }).where(eq(products.id, localId)).run(); return; }
    const existing = t.select().from(products).where(eq(products.id, serverId)).get();
    if (existing) {
      // El producto ya existía en el servidor (vinculado por SKU) o ya bajó por el pull: se conserva el del servidor.
      t.delete(productRefs).where(eq(productRefs.productId, localId)).run();
      t.delete(products).where(eq(products.id, localId)).run();
    } else {
      t.update(products).set({ id: serverId, isLocal: false }).where(eq(products.id, localId)).run();
      t.update(productRefs).set({ productId: serverId }).where(eq(productRefs.productId, localId)).run();
      t.update(productPrices).set({ productId: serverId }).where(eq(productPrices.productId, localId)).run();
    }
  });
}

export interface ProductFormValues {
  id: string; sku: string; name: string; description: string; categoryId: string | null; unitId: string | null; taxId: string | null; brand: string; locationId: string | null;
  minStock: string; maxStock: string; isService: boolean; barcodes: string[]; price: string; version: number; isLocal: boolean; trackingMode: string; lastOp: OutboxRow | null;
}

/** Valores actuales para precargar el formulario de edición (precio = el vigente en la lista predeterminada). */
export function getProductForEdit(db: AppDb, id: string, today: string): ProductFormValues | null {
  const p = db.select().from(products).where(eq(products.id, id)).get();
  if (!p) return null;
  const listId = defaultPriceListId(db);
  const price = listId
    ? db.all<{ price: string }>(sql`SELECT price FROM product_prices WHERE product_id = ${id} AND price_list_id = ${listId} AND valid_from <= ${today} ORDER BY valid_from DESC LIMIT 1`)[0]?.price ?? ''
    : '';
  const barcodes = db.select({ code: productRefs.code }).from(productRefs).where(and(eq(productRefs.productId, id), eq(productRefs.kind, 'BARCODE'))).all().map((r) => r.code);
  return {
    id: p.id, sku: p.sku, name: p.name, description: p.description ?? '', categoryId: p.categoryId, unitId: p.unitId, taxId: p.taxId, brand: p.brand ?? '', locationId: p.locationId,
    minStock: p.minStock ?? '', maxStock: p.maxStock ?? '', isService: p.isService, barcodes, price, version: p.version, isLocal: p.isLocal, trackingMode: p.trackingMode,
    lastOp: latestForEntity(db, 'product', id) ?? null,
  };
}

// ───────────────── catálogos para los selectores ─────────────────
export interface Option { id: string; label: string }

export const listUnits = (db: AppDb): Option[] => db.select().from(units).orderBy(units.code).all().map((u) => ({ id: u.id, label: `${u.code} · ${u.name}` }));
export const listCategories = (db: AppDb): Option[] => db.select().from(categories).orderBy(categories.name).all().map((c) => ({ id: c.id, label: c.name }));
export const listLocations = (db: AppDb): Option[] => db.select().from(locations).where(eq(locations.isActive, true)).orderBy(locations.code).all().map((l) => ({ id: l.id, label: l.name && l.name !== l.code ? `${l.code} · ${l.name}` : l.code }));
/** Impuestos vigentes hoy. */
export const listTaxes = (db: AppDb, today: string): Option[] =>
  db.select().from(taxes).orderBy(taxes.code).all().filter((t) => t.validFrom <= today && (!t.validTo || t.validTo >= today)).map((t) => ({ id: t.id, label: `${t.name} (${t.rate} %)` }));

/** Unidad y impuesto sugeridos para un producto nuevo: `UND` y el IVA general más alto vigente. */
export function defaultsForNew(db: AppDb, today: string): { unitId: string | null; taxId: string | null } {
  const unit = db.select().from(units).all().find((u) => u.code.toUpperCase() === 'UND') ?? db.select().from(units).get();
  const vat = db.select().from(taxes).all().filter((t) => t.kind === 'VAT' && t.validFrom <= today && (!t.validTo || t.validTo >= today)).sort((a, b) => Number(b.rate) - Number(a.rate));
  return { unitId: unit?.id ?? null, taxId: vat.find((t) => Number(t.rate) === 16)?.id ?? vat[0]?.id ?? null };
}
