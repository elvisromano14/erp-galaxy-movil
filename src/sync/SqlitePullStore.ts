import { eq, getTableColumns, inArray, or, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { PullEntity, PullPage } from '../core/api/contract';
import { META, getMeta, setMeta, setJson } from '../db/meta';
import {
  appSettings, customers, exchangeRates, priceLists, productPrices, productRefs, products, salesDocumentLines, salesDocuments, stockSnapshots, taxes, warehouses,
} from '../db/schema';
import type { AppDb } from '../db/types';
import { normalizeText } from './normalize';
import type { PullStore } from './pull';

type Item = Record<string, any>;

/** Estados locales de un documento con cambios que el pull NO debe pisar. */
const PENDING_LOCAL = ['DRAFT', 'PENDING_SYNC', 'REJECTED', 'NEEDS_REVIEW'];
/** Límite de variables de SQLite en Android antiguos (999): se inserta por trozos. */
const MAX_VARS = 900;

const ex = (c: SQLiteColumn) => sql.raw(`excluded."${c.name}"`);
const setFrom = (cols: Record<string, SQLiteColumn>, omit: string[] = []) =>
  Object.fromEntries(Object.entries(cols).filter(([k]) => !omit.includes(k)).map(([k, c]) => [k, ex(c)]));

function chunked<T>(rows: T[], colsPerRow: number, fn: (chunk: T[]) => void) {
  const size = Math.max(1, Math.floor(MAX_VARS / colsPerRow));
  for (let i = 0; i < rows.length; i += size) fn(rows.slice(i, i + size));
}

/**
 * Aplica las páginas del servidor a SQLite. Cada página se aplica junto con su cursor en UNA transacción
 * (si algo falla, ni los datos ni el cursor avanzan → reanudable y sin huecos).
 */
export class SqlitePullStore implements PullStore {
  constructor(private readonly db: AppDb) {}

  async getCursor(entity: PullEntity) { return getMeta(this.db, META.cursor(entity)); }

  async applyPage(page: PullPage, nextCursor: string | null) {
    this.db.transaction((tx) => {
      const db = tx as AppDb;
      const items = page.items as Item[];
      switch (page.entity) {
        case 'app_settings': this.settings(db, items); break;
        case 'taxes': this.replaceAll(db, taxes, items.filter((i) => !i.deletedAt && i.isActive !== false).map((i) => ({
          id: i.id, code: i.code, name: i.name, kind: i.kind, rate: String(i.rate), validFrom: day(i.validFrom), validTo: i.validTo ? day(i.validTo) : null })), 7); break;
        case 'price_lists': this.replaceAll(db, priceLists, items.filter((i) => !i.deletedAt).map((i) => ({
          id: i.id, code: i.code, name: i.name, currencyId: i.currencyId, isDefault: !!i.isDefault })), 5); break;
        case 'warehouses': this.replaceAll(db, warehouses, items.filter((i) => !i.deletedAt).map((i) => ({
          id: i.id, code: i.code, name: i.name, isActive: i.isActive !== false })), 4); break;
        case 'exchange_rates': this.replaceAll(db, exchangeRates, items.map((i) => ({
          id: i.id, currencyId: i.currencyId, rate: String(i.rate), date: day(i.date), source: i.source })), 5); break;
        case 'customers': this.customers(db, items); break;
        case 'products': this.products(db, items); break;
        case 'product_prices': this.prices(db, items); break;
        case 'stock_snapshots': this.stock(db, items); break;
        case 'my_documents': this.documents(db, items); break;
      }
      // Catálogos completos no usan cursor; los demás guardan el avance en la misma transacción.
      if (!page.fullRefresh && nextCursor) setMeta(db, META.cursor(page.entity), nextCursor);
    });
  }

  // ───────────────── catálogos completos ─────────────────
  private replaceAll(db: AppDb, table: SQLiteTable, rows: Item[], cols: number) {
    db.delete(table).run();
    chunked(rows, cols, (c) => db.insert(table).values(c as never).run());
  }

  private settings(db: AppDb, items: Item[]) {
    const s = items[0];
    if (!s) return;
    db.insert(appSettings).values({ id: 1, json: JSON.stringify(s) }).onConflictDoUpdate({ target: appSettings.id, set: { json: JSON.stringify(s) } }).run();
    // La empresa y el vendedor activos también quedan en sync_meta (lectura rápida sin parsear el JSON).
    if (s.company?.id) setMeta(db, META.companyId, s.company.id);
    setJson(db, 'seller', s.seller ?? null);
  }

  // ───────────────── clientes y productos (con versión y lápidas) ─────────────────
  private customers(db: AppDb, items: Item[]) {
    const rows = items.map((c) => ({
      id: c.id, rif: c.rif, legalName: c.legalName, tradeName: c.tradeName ?? null, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null,
      priceListId: c.priceListId ?? null, creditLimit: String(c.creditLimit ?? '0'), creditDays: c.creditDays ?? 0,
      balanceSnapshot: String(c.balanceSnapshot ?? '0'), overdueSnapshot: String(c.overdueSnapshot ?? '0'), validationStatus: c.validationStatus ?? 'VALIDATED',
      // Lápida: no se borra (puede haber documentos locales que lo referencian): se marca inactivo.
      isActive: c.isActive !== false && !c.deletedAt, isLocal: false,
      searchText: normalizeText(c.rif, c.legalName, c.tradeName, c.phone), version: c.version ?? 1,
    }));
    chunked(rows, 17, (chunk) => db.insert(customers).values(chunk).onConflictDoUpdate({
      target: customers.id, set: setFrom(getTableColumns(customers), ['id']), setWhere: sql`excluded."version" >= ${customers.version}`,
    }).run());
  }

  private products(db: AppDb, items: Item[]) {
    const rows = items.map((p) => {
      const refs: Item[] = p.refs ?? [];
      const barcodes: string[] = p.barcodes ?? [];
      return {
        id: p.id, sku: p.sku, name: p.name, description: p.description ?? null, categoryName: p.categoryName ?? null, unitCode: p.unitCode ?? null, taxId: p.taxId ?? null,
        trackingMode: p.trackingMode ?? 'NONE', isService: !!p.isService, isActive: p.isActive !== false && !p.deletedAt,
        searchText: normalizeText(p.sku, p.name, p.description, refs.map((r) => r.code).join(' '), barcodes.join(' ')), version: p.version ?? 1,
      };
    });
    chunked(rows, 11, (chunk) => db.insert(products).values(chunk).onConflictDoUpdate({
      target: products.id, set: setFrom(getTableColumns(products), ['id']), setWhere: sql`excluded."version" >= ${products.version}`,
    }).run());
    // Referencias y códigos de barras: se reemplazan las de los productos de la página.
    const ids = items.map((p) => p.id as string);
    chunked(ids, 1, (chunk) => db.delete(productRefs).where(inArray(productRefs.productId, chunk)).run());
    const refRows = items.flatMap((p) => [
      ...((p.refs ?? []) as Item[]).map((r) => ({ productId: p.id as string, kind: String(r.kind), code: String(r.code), brand: (r.brand ?? null) as string | null })),
      ...((p.barcodes ?? []) as string[]).map((b) => ({ productId: p.id as string, kind: 'BARCODE', code: b, brand: null as string | null })),
    ]);
    chunked(refRows, 4, (chunk) => db.insert(productRefs).values(chunk).onConflictDoNothing().run());
  }

  private prices(db: AppDb, items: Item[]) {
    const rows = items.map((p) => ({ id: p.id, productId: p.productId, priceListId: p.priceListId, price: String(p.price), validFrom: day(p.validFrom) }));
    chunked(rows, 5, (chunk) => db.insert(productPrices).values(chunk).onConflictDoUpdate({
      target: productPrices.id, set: setFrom(getTableColumns(productPrices), ['id']),
    }).run());
  }

  private stock(db: AppDb, items: Item[]) {
    const rows = items.map((s) => ({ id: s.id, productId: s.productId, warehouseId: s.warehouseId, quantity: String(s.quantity), reserved: String(s.reserved), asOf: iso(s.asOf) }));
    chunked(rows, 6, (chunk) => db.insert(stockSnapshots).values(chunk).onConflictDoUpdate({
      target: stockSnapshots.id, set: setFrom(getTableColumns(stockSnapshots), ['id']),
    }).run());
  }

  // ───────────────── documentos del vendedor ─────────────────
  /** El pull no pisa documentos con cambios locales (borrador, pendiente, rechazado, en revisión). */
  private documents(db: AppDb, items: Item[]) {
    for (const d of items) {
      const local = db.select().from(salesDocuments).where(or(eq(salesDocuments.serverId, d.id), eq(salesDocuments.id, d.id))).get();
      if (local && PENDING_LOCAL.includes(local.localStatus)) continue;
      const id = local?.id ?? d.id;
      const row = {
        id, serverId: d.id as string, docType: d.docType as string, customerId: d.customerId as string, localNumber: local?.localNumber ?? null, serverNumber: (d.number ?? null) as string | null,
        currencyId: d.currencyId as string, exchangeRate: d.exchangeRate != null ? String(d.exchangeRate) : null, paymentCondition: (d.paymentCondition ?? 'CASH') as string,
        creditDays: (d.creditDays ?? 0) as number, warehouseId: (d.warehouseId ?? null) as string | null, validUntil: d.validUntil ? day(d.validUntil) : null, notes: (d.notes ?? null) as string | null,
        sourceDocumentId: (d.parent?.id ?? null) as string | null, subtotal: String(d.subtotal ?? '0'), taxTotal: String(d.taxTotal ?? '0'), total: String(d.total ?? '0'),
        localStatus: 'SYNCED', serverStatus: d.status as string, syncError: null, createdAtDevice: local?.createdAtDevice ?? iso(d.updatedAt), updatedAt: iso(d.updatedAt), version: (d.version ?? 1) as number,
      };
      db.insert(salesDocuments).values(row).onConflictDoUpdate({ target: salesDocuments.id, set: setFrom(getTableColumns(salesDocuments), ['id', 'createdAtDevice']) }).run();
      db.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, id)).run();
      const lines = ((d.lines ?? []) as Item[]).map((l) => ({
        id: l.id as string, documentId: id, productId: l.productId as string, sku: (l.sku ?? null) as string | null, description: (l.description ?? null) as string | null,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountPct: String(l.discountPct ?? '0'), taxId: (l.taxId ?? null) as string | null, taxRate: String(l.taxRate ?? '0'), lineTotal: String(l.net ?? '0'),
      }));
      chunked(lines, 11, (chunk) => db.insert(salesDocumentLines).values(chunk).run());
    }
  }
}

/** Fecha `AAAA-MM-DD` desde un ISO del servidor. */
const day = (v: unknown) => String(v).slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString()));

