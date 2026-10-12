import { eq, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { formatRif, isValidRif } from '../../vendor/erp-domain';
import { uuidv7 } from '../../core/uuid';
import { normalizeText } from '../../sync/normalize';
import { customers, salesDocuments } from '../schema';
import type { AppDb } from '../types';
import { enqueue, latestForEntity, type OutboxRow } from './outbox';

export type CustomerRow = typeof customers.$inferSelect;

export interface CustomerInput { rif: string; legalName: string; tradeName?: string | null; phone?: string | null; email?: string | null; address?: string | null }

/** Error de validación local (el mensaje se muestra tal cual al vendedor). */
export class CustomerError extends Error {
  constructor(message: string, readonly code: 'INVALID_RIF' | 'NAME_REQUIRED' | 'DUPLICATE_RIF' | 'NOT_EDITABLE' | 'INVALID_EMAIL' | 'NOT_FOUND', readonly existingId?: string) { super(message); this.name = 'CustomerError'; }
}

const clean = (v?: string | null) => { const t = v?.trim(); return t ? t : null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(i: CustomerInput) {
  if (!isValidRif(i.rif)) throw new CustomerError('RIF inválido (ejemplo: J-12345678-9)', 'INVALID_RIF');
  if (!i.legalName.trim() || i.legalName.trim().length < 2) throw new CustomerError('Indique la razón social', 'NAME_REQUIRED');
  if (clean(i.email) && !EMAIL.test(i.email!.trim())) throw new CustomerError('Correo inválido', 'INVALID_EMAIL');
  return { rif: formatRif(i.rif), legalName: i.legalName.trim(), tradeName: clean(i.tradeName), phone: clean(i.phone), email: clean(i.email)?.toLowerCase() ?? null, address: clean(i.address) };
}

export interface CustomerListRow extends CustomerRow { sync: 'LOCAL_PENDING' | 'REJECTED' | 'REVIEW' | null }

/** Lista/búsqueda local (RIF, razón social, nombre comercial, teléfono). Los pendientes de envío o rechazados llevan su marca. */
export function searchCustomers(db: AppDb, o: { query?: string; limit?: number; offset?: number } = {}): CustomerListRow[] {
  const tokens = normalizeText(o.query).split(' ').filter(Boolean);
  const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const where = [sql`c.is_active = 1`, ...tokens.map((t) => sql`c.search_text LIKE ${'%' + esc(t) + '%'} ESCAPE '\\'`)];
  const rows = db.all<Record<string, any>>(sql`
    SELECT c.*,
      (SELECT o.status FROM outbox o WHERE o.entity = 'customer' AND o.entity_id = c.id ORDER BY o.client_seq DESC LIMIT 1) AS lastOp
    FROM customers c WHERE ${sql.join(where, sql` AND `)}
    ORDER BY c.is_local DESC, c.legal_name LIMIT ${o.limit ?? 50} OFFSET ${o.offset ?? 0}`);
  return rows.map((r) => ({
    id: r.id, rif: r.rif, legalName: r.legal_name, tradeName: r.trade_name, phone: r.phone, email: r.email, address: r.address, priceListId: r.price_list_id,
    creditLimit: r.credit_limit, creditDays: r.credit_days, balanceSnapshot: r.balance_snapshot, overdueSnapshot: r.overdue_snapshot, validationStatus: r.validation_status,
    isActive: !!r.is_active, isLocal: !!r.is_local, searchText: r.search_text, version: r.version,
    sync: r.lastOp === 'PENDING' || r.lastOp === 'SENDING' ? 'LOCAL_PENDING' : r.lastOp === 'REJECTED' ? 'REJECTED' : r.lastOp === 'REVIEW' ? 'REVIEW' : null,
  }));
}

export interface CustomerDetail extends CustomerRow {
  /** Crédito disponible indicativo (límite − saldo), en Bs; null si no tiene límite. */
  availableCredit: string | null;
  lastOp: OutboxRow | null;
  /** Se puede editar desde el móvil: solo clientes propios aún sin validar por administración. */
  editable: boolean;
}

export function getCustomer(db: AppDb, id: string): CustomerDetail | null {
  const c = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!c) return null;
  const limit = new Decimal(c.creditLimit);
  const lastOp = latestForEntity(db, 'customer', id) ?? null;
  return {
    ...c, lastOp,
    availableCredit: limit.gt(0) ? limit.minus(c.balanceSnapshot).toFixed(2) : null,
    editable: c.validationStatus === 'PENDING' || c.isLocal,
  };
}

/**
 * Alta de cliente sin conexión: valida el RIF con el mismo código del servidor, lo guarda localmente (usable de inmediato en
 * documentos) y encola `customer.create`. Fila + operación en UNA transacción.
 */
export function createCustomerLocal(db: AppDb, input: CustomerInput, now = new Date()): CustomerRow {
  const d = normalize(input);
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const dup = t.select({ id: customers.id, legalName: customers.legalName }).from(customers).where(eq(customers.rif, d.rif)).get();
    if (dup) throw new CustomerError(`Ya existe un cliente con ese RIF: ${dup.legalName}`, 'DUPLICATE_RIF', dup.id);
    const id = uuidv7(now.getTime());
    const row = t.insert(customers).values({
      id, ...d, creditLimit: '0', creditDays: 0, validationStatus: 'PENDING', isActive: true, isLocal: true,
      searchText: normalizeText(d.rif, d.legalName, d.tradeName, d.phone), version: 1,
    }).returning().get();
    enqueue(t, { entity: 'customer', action: 'create', entityId: id, payload: d, now });
    return row;
  });
}

/**
 * Edición de un cliente propio sin validar. Si el alta aún no se envió (o fue rechazada), la edición se funde en ella;
 * si ya está en el servidor, se encola un `update`. El RIF no se cambia una vez creado.
 */
export function updateCustomerLocal(db: AppDb, id: string, patch: Omit<CustomerInput, 'rif'>, now = new Date()): CustomerRow {
  return db.transaction((tx) => {
    const t = tx as AppDb;
    const c = t.select().from(customers).where(eq(customers.id, id)).get();
    if (!c) throw new CustomerError('Cliente no encontrado', 'NOT_FOUND');
    if (!(c.isLocal || c.validationStatus === 'PENDING')) throw new CustomerError('El cliente ya fue validado: los cambios se hacen desde la oficina', 'NOT_EDITABLE');
    const d = normalize({ ...patch, rif: c.rif });
    const row = t.update(customers).set({ legalName: d.legalName, tradeName: d.tradeName, phone: d.phone, email: d.email, address: d.address, searchText: normalizeText(c.rif, d.legalName, d.tradeName, d.phone) }).where(eq(customers.id, id)).returning().get();
    const last = latestForEntity(t, 'customer', id);
    // Alta rechazada por el servidor: se vuelve a enviar como un alta NUEVA (el servidor no tiene esa entidad).
    const action = c.isLocal && (!last || last.status === 'REJECTED') ? 'create' : c.isLocal ? 'update' : 'update';
    const payload = action === 'create' ? { rif: c.rif, legalName: d.legalName, tradeName: d.tradeName, phone: d.phone, email: d.email, address: d.address } : { legalName: d.legalName, tradeName: d.tradeName, phone: d.phone, email: d.email, address: d.address };
    enqueue(t, { entity: 'customer', action, entityId: id, payload, now });
    return row;
  });
}

/**
 * El servidor confirmó el alta: la fila local pasa a usar el id del servidor (o se fusiona con la que ya bajó por el pull / el cliente
 * existente al vincular por RIF) y los documentos locales que la referenciaban se re-apuntan.
 */
export function remapCustomer(db: AppDb, localId: string, serverId: string, serverStatus?: string) {
  db.transaction((tx) => {
    const t = tx as AppDb;
    const local = t.select().from(customers).where(eq(customers.id, localId)).get();
    if (!local) return;
    if (localId !== serverId) {
      const existing = t.select().from(customers).where(eq(customers.id, serverId)).get();
      if (existing) t.delete(customers).where(eq(customers.id, localId)).run();
      else t.update(customers).set({ id: serverId, isLocal: false, ...(serverStatus ? { validationStatus: serverStatus } : {}) }).where(eq(customers.id, localId)).run();
      t.update(salesDocuments).set({ customerId: serverId }).where(eq(salesDocuments.customerId, localId)).run();
    } else {
      t.update(customers).set({ isLocal: false, ...(serverStatus ? { validationStatus: serverStatus } : {}) }).where(eq(customers.id, localId)).run();
    }
  });
}
