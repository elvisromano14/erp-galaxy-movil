import { remapCustomer } from '../db/repositories/customers';
import { remapProduct } from '../db/repositories/productEdit';
import { salesDocHandler } from './docHandlers';
import type { ResultHandler } from './SyncEngine';

/** Resultados por entidad. Clientes (M3); cotizaciones y pedidos se agregan en M4 y M5. */
export const customerHandler: ResultHandler = {
  /** Alta confirmada (o vinculada por RIF a un cliente existente): la fila local adopta el id del servidor. */
  applied(db, op, r) {
    if (op.action === 'create' && r.serverId) remapCustomer(db, op.entityId, r.serverId, r.serverStatus);
  },
};

/** Productos: el alta confirmada (o vinculada por SKU a uno existente) hace que la fila local adopte el id del servidor. La edición la trae el pull. */
export const productHandler: ResultHandler = {
  applied(db, op, r) {
    if (op.action === 'create' && r.serverId) remapProduct(db, op.entityId, r.serverId);
  },
};

export const defaultHandlers = { customer: customerHandler, product: productHandler, sales_quote: salesDocHandler, sales_order: salesDocHandler };
