// Contrato de sincronización con el ERP (ver docs/API-MOVIL.md). Los tipos de datos del servidor se leen de
// src/vendor/erp/schema.d.ts (generado del OpenAPI); aquí solo se tipan las respuestas de sync/* y devices/*.

export const PULL_ORDER = [
  'app_settings', 'currencies', 'taxes', 'exchange_rates', 'price_lists', 'warehouses', 'customers', 'products', 'product_prices', 'stock_snapshots', 'my_documents',
] as const;
export type PullEntity = (typeof PULL_ORDER)[number];

export interface PullPage<T = Record<string, unknown>> {
  entity: PullEntity;
  items: T[];
  /** Cursor para la siguiente página (opaco). */
  nextCursor: string | null;
  hasMore: boolean;
  /** true = la app reemplaza la tabla local completa (catálogos pequeños). */
  fullRefresh: boolean;
  serverTime: string;
}

export type OpStatus = 'APPLIED' | 'DUPLICATE' | 'REJECTED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'RETRY';
export interface OpResult {
  clientOpId: string;
  status: OpStatus;
  errorCode?: string; message?: string;
  serverId?: string; serverNumber?: string | null; serverStatus?: string;
  /** El cliente ya existía por RIF y se vinculó al existente. */
  linked?: boolean;
}

export type SyncEntity = 'customer' | 'sales_quote' | 'sales_order';
export interface PushOperation {
  clientOpId: string; clientSeq: number; entity: SyncEntity; action: 'create' | 'update';
  /** Id local (UUID v7 generado en el dispositivo). */
  entityId: string; data: Record<string, unknown>;
}

/** Existencia en vivo (sin costos): `GET /sync/stock/:productId`. */
export interface LiveStock {
  productId: string; sku: string; name: string; asOf: string;
  warehouses: { warehouseId: string; code: string; name: string; quantity: string; reserved: string; available: string }[];
}

export interface DeviceInfo { id: string; deviceCode: string; name: string; platform: string; appVersion: string | null }
export interface AppConfig { minAppVersion: string; latestAppVersion: string; schemaVersion: number; maintenance: { message: string } | null; serverTime: string }
