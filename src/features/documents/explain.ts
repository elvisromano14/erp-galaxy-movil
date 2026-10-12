/** Estado del servidor en español (cotizaciones y pedidos). */
export const SERVER_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador', SENT: 'Enviada', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', EXPIRED: 'Vencida', CONVERTED: 'Convertida',
  CONFIRMED: 'Confirmado', PARTIALLY_INVOICED: 'Facturado parcialmente', INVOICED: 'Facturado', CANCELLED: 'Anulado',
};

const HELP: Record<string, string> = {
  CREDIT_LIMIT_EXCEEDED: 'El pedido supera el límite de crédito del cliente. Quedó en borrador en la oficina: administración debe revisarlo y autorizarlo, o el cliente debe abonar.',
  PRODUCT_INACTIVE: 'Uno de los productos fue desactivado. Quite esa línea o cámbiela por otro producto y reenvíe.',
  PRODUCT_NOT_FOUND: 'Un producto ya no existe en el sistema. Quite esa línea y reenvíe.',
  DISCOUNT_NOT_ALLOWED: 'El descuento de una línea supera el máximo permitido a su usuario. Reduzca el descuento y reenvíe.',
  PRICE_NOT_FOUND: 'Un producto no tiene precio en la lista del cliente. Pida a administración que lo cargue.',
  CUSTOMER_NOT_FOUND: 'El cliente ya no existe en el sistema.',
  CUSTOMER_INACTIVE: 'El cliente está inactivo. Pida a administración que lo reactive.',
  CUSTOMER_CREATE_NOT_ALLOWED: 'Su usuario no puede crear clientes desde el móvil.',
  QUOTE_EXPIRED: 'La cotización de origen venció. Cree el pedido nuevamente: se actualizarán los precios.',
  INVALID_STATE: 'El documento cambió de estado en la oficina y ya no admite esta operación. Sincronice para ver su estado actual.',
  TAX_NOT_VALID: 'Un impuesto no está vigente en la fecha del documento. Avise a administración.',
  SELLER_REQUIRED: 'Su usuario no está ligado a un vendedor. Pida a administración que lo asigne.',
  FORBIDDEN: 'Su usuario no tiene permiso para esta operación.',
  DEPENDENCY_REJECTED: 'Depende de otra operación que fue rechazada (por ejemplo, el alta de un cliente). Corrija primero esa operación.',
  VALIDATION_ERROR: 'Algún dato del documento no es válido. Revise los campos y reenvíe.',
};

/** Convierte «CODIGO: mensaje» (lo que guarda la cola) en una explicación comprensible con qué hacer. */
export function explainError(raw: string | null | undefined): string {
  if (!raw) return 'El servidor no aceptó la operación.';
  const m = /^([A-Z_]+):\s*(.*)$/.exec(raw);
  const code = m?.[1]; const detail = m?.[2]?.trim();
  const help = code ? HELP[code] : undefined;
  if (help) return detail && !help.includes(detail) ? `${help} (${detail})` : help;
  return detail || raw;
}
