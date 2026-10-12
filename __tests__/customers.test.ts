import { eq } from 'drizzle-orm';
import { CustomerError, createCustomerLocal, getCustomer, remapCustomer, searchCustomers, updateCustomerLocal } from '../src/db/repositories/customers';
import { enqueue, setOutcome } from '../src/db/repositories/outbox';
import { wipeReplica } from '../src/db/replica';
import { customers, outbox, salesDocuments } from '../src/db/schema';
import { createTestDb } from './testDb';

const base = { rif: 'v-19322174-9', legalName: 'Taller El Sol, C.A.', phone: '0412-5551234', address: 'Av. Principal' };

describe('clientes locales', () => {
  it('alta: valida el RIF, normaliza, queda pendiente de validación y encola el alta en la misma transacción', () => {
    const { db } = createTestDb();
    const c = createCustomerLocal(db, base);
    expect(c).toMatchObject({ rif: 'V-19322174-9', validationStatus: 'PENDING', isLocal: true, creditLimit: '0' });
    expect(c.searchText).toContain('taller el sol');
    const ops = db.select().from(outbox).all();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'customer', action: 'create', entityId: c.id, status: 'PENDING' });
    expect(JSON.parse(ops[0].payloadJson)).toMatchObject({ rif: 'V-19322174-9', legalName: 'Taller El Sol, C.A.' });
  });

  it('rechaza RIF inválido, razón social vacía, correo inválido y RIF duplicado — sin dejar nada a medias', () => {
    const { db } = createTestDb();
    expect(() => createCustomerLocal(db, { ...base, rif: 'V-19322174-1' })).toThrow(expect.objectContaining({ code: 'INVALID_RIF' }));
    expect(() => createCustomerLocal(db, { ...base, legalName: ' ' })).toThrow(expect.objectContaining({ code: 'NAME_REQUIRED' }));
    expect(() => createCustomerLocal(db, { ...base, email: 'no-es-correo' })).toThrow(expect.objectContaining({ code: 'INVALID_EMAIL' }));
    const first = createCustomerLocal(db, base);
    let dup: unknown; try { createCustomerLocal(db, { ...base, rif: 'V193221749' }); } catch (e) { dup = e; }
    expect(dup).toBeInstanceOf(CustomerError); expect((dup as CustomerError).existingId).toBe(first.id);
    expect(db.select().from(customers).all()).toHaveLength(1); expect(db.select().from(outbox).all()).toHaveLength(1);
  });

  it('editar antes de enviar se funde en el alta pendiente; el RIF no cambia', () => {
    const { db } = createTestDb();
    const c = createCustomerLocal(db, base);
    updateCustomerLocal(db, c.id, { legalName: 'Taller El Sol 2', phone: '0414-0000000' });
    const ops = db.select().from(outbox).all();
    expect(ops).toHaveLength(1); expect(ops[0].action).toBe('create');
    expect(JSON.parse(ops[0].payloadJson)).toMatchObject({ rif: 'V-19322174-9', legalName: 'Taller El Sol 2', phone: '0414-0000000' });
    expect(db.select().from(customers).get()).toMatchObject({ rif: 'V-19322174-9', legalName: 'Taller El Sol 2' });
  });

  it('cliente ya sincronizado y sin validar: la edición va como update; validado: no se puede editar', () => {
    const { db } = createTestDb();
    const c = createCustomerLocal(db, base);
    setOutcome(db, db.select().from(outbox).get()!.clientOpId, { status: 'DONE' });
    remapCustomer(db, c.id, 'server-1', 'PENDING');
    updateCustomerLocal(db, 'server-1', { legalName: 'Nuevo nombre' });
    expect(db.select().from(outbox).all().map((o) => `${o.action}:${o.status}`)).toEqual(['create:DONE', 'update:PENDING']);
    db.update(customers).set({ validationStatus: 'VALIDATED' }).where(eq(customers.id, 'server-1')).run();
    expect(getCustomer(db, 'server-1')!.editable).toBe(false);
    expect(() => updateCustomerLocal(db, 'server-1', { legalName: 'X' })).toThrow(expect.objectContaining({ code: 'NOT_EDITABLE' }));
  });

  it('alta rechazada por el servidor: al corregirla se reenvía como alta NUEVA', () => {
    const { db } = createTestDb();
    const c = createCustomerLocal(db, base);
    setOutcome(db, db.select().from(outbox).get()!.clientOpId, { status: 'REJECTED', error: 'CUSTOMER_CREATE_NOT_ALLOWED: …' });
    updateCustomerLocal(db, c.id, { legalName: 'Corregido' });
    expect(db.select().from(outbox).all().map((o) => `${o.action}:${o.status}`)).toEqual(['create:REJECTED', 'create:PENDING']);
  });

  it('remapCustomer: adopta el id del servidor, re-apunta documentos y fusiona si el cliente ya había bajado por el pull', () => {
    const { db } = createTestDb();
    const c = createCustomerLocal(db, base);
    db.insert(salesDocuments).values({ id: 'd1', docType: 'QUOTE', customerId: c.id, currencyId: 'usd', createdAtDevice: 'n', updatedAt: 'n' }).run();
    remapCustomer(db, c.id, 'srv-1', 'PENDING');
    expect(db.select().from(customers).get()).toMatchObject({ id: 'srv-1', isLocal: false });
    expect(db.select().from(salesDocuments).get()!.customerId).toBe('srv-1');
    // vinculado a uno existente (ya presente por el pull): se descarta la fila local
    const d = createCustomerLocal(db, { ...base, rif: 'J-12345678-4', legalName: 'Otro' });
    db.insert(customers).values({ id: 'srv-2', rif: 'J-12345678-4', legalName: 'Otro (servidor)', searchText: 'x', version: 3 }).run();
    remapCustomer(db, d.id, 'srv-2');
    expect(db.select().from(customers).all().map((x) => x.id).sort()).toEqual(['srv-1', 'srv-2']);
    expect(db.select().from(customers).where(eq(customers.id, 'srv-2')).get()!.legalName).toBe('Otro (servidor)');
  });

  it('búsqueda por RIF/nombre con marca de sincronización; los pendientes van primero', () => {
    const { db } = createTestDb();
    db.insert(customers).values({ id: 's1', rif: 'J-30000000-1', legalName: 'Repuestos Beta', searchText: 'j-30000000-1 repuestos beta', version: 1 }).run();
    const mine = createCustomerLocal(db, base);
    expect(searchCustomers(db).map((c) => c.legalName)).toEqual(['Taller El Sol, C.A.', 'Repuestos Beta']);
    expect(searchCustomers(db, { query: 'taller' })[0]).toMatchObject({ id: mine.id, sync: 'LOCAL_PENDING' });
    expect(searchCustomers(db, { query: 'j-3000' }).map((c) => c.id)).toEqual(['s1']);
    expect(searchCustomers(db, { query: 'repuestos' })[0].sync).toBeNull();
    setOutcome(db, db.select().from(outbox).get()!.clientOpId, { status: 'REJECTED', error: 'x' });
    expect(searchCustomers(db, { query: 'taller' })[0].sync).toBe('REJECTED');
  });

  it('crédito disponible indicativo = límite − saldo (sin límite → sin dato)', () => {
    const { db } = createTestDb();
    db.insert(customers).values([{ id: 'a', rif: 'J-1', legalName: 'A', creditLimit: '1000', balanceSnapshot: '250.5', searchText: 'a', version: 1 }, { id: 'b', rif: 'J-2', legalName: 'B', searchText: 'b', version: 1 }]).run();
    expect(getCustomer(db, 'a')!.availableCredit).toBe('749.50'); expect(getCustomer(db, 'b')!.availableCredit).toBeNull();
    expect(getCustomer(db, 'zzz')).toBeNull();
  });

  it('restablecer réplica conserva los clientes locales sin confirmar', () => {
    const { db } = createTestDb();
    db.insert(customers).values({ id: 's1', rif: 'J-1', legalName: 'Del servidor', searchText: 'x', version: 1 }).run();
    const mine = createCustomerLocal(db, base);
    wipeReplica(db);
    expect(db.select().from(customers).all().map((c) => c.id)).toEqual([mine.id]);
    enqueue(db, { entity: 'customer', action: 'update', entityId: 'x', payload: {} }); // la cola siempre se conserva
    expect(db.select().from(outbox).all().length).toBeGreaterThan(0);
  });
});
