/** Códigos de error del ERP que la app trata de forma especial (ver docs/API-MOVIL.md). */
export type ApiErrorCode =
  | 'DEVICE_REVOKED' | 'DEVICE_UNKNOWN' | 'DEVICE_REQUIRED' | 'DEVICE_LIMIT_REACHED' | 'DEVICE_OWNED_BY_OTHER'
  | 'UPGRADE_REQUIRED' | 'SELLER_REQUIRED' | 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'REFRESH_INVALID' | 'TOKEN_REVOKED'
  | 'NETWORK_ERROR' | 'SESSION_EXPIRED' | 'UNKNOWN' | (string & {});

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string, readonly details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
  }
  /** Sin respuesta del servidor (sin red, tiempo agotado): la operación debe reintentarse. */
  get isNetwork() { return this.status === 0; }
  /** Error del servidor (5xx): reintentar con espera. */
  get isRetryable() { return this.status === 0 || this.status >= 500 || this.status === 429; }
  /** El dispositivo ya no puede operar: bloquear la app (ver sección 11 del plan). */
  get blocksApp() { return this.code === 'DEVICE_REVOKED' || this.code === 'UPGRADE_REQUIRED'; }
}
