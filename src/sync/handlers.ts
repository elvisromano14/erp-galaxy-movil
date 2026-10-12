import { remapCustomer } from '../db/repositories/customers';
import type { ResultHandler } from './SyncEngine';

/** Resultados por entidad. Clientes (M3); cotizaciones y pedidos se agregan en M4 y M5. */
export const customerHandler: ResultHandler = {
  /** Alta confirmada (o vinculada por RIF a un cliente existente): la fila local adopta el id del servidor. */
  applied(db, op, r) {
    if (op.action === 'create' && r.serverId) remapCustomer(db, op.entityId, r.serverId, r.serverStatus);
  },
};

export const defaultHandlers = { customer: customerHandler };
