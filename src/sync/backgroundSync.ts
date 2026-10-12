import type { ApiClient, TokenStore } from '../core/api/ApiClient';
import type { AuthService } from '../core/auth/AuthService';
import { logger } from '../core/telemetry/log';
import { isBootstrapped } from './bootstrap';
import type { SyncEngine } from './SyncEngine';
import type { AppDb } from '../db/types';

export type BackgroundResult = 'success' | 'failed' | 'skipped';

/**
 * Sincronización desde la tarea en segundo plano (complementaria: el sistema no la garantiza; la app SIEMPRE sincroniza al abrir y al volver la red).
 * Sin sesión o sin descarga inicial no hace nada. No borra datos ni bloquea la app: si el dispositivo fue revocado o la versión es
 * obsoleta, lo detecta la siguiente sincronización en primer plano.
 */
export async function runBackgroundSync(d: { api: ApiClient; auth: AuthService; tokens: TokenStore; engine: SyncEngine; db: AppDb }): Promise<BackgroundResult> {
  try {
    if (!(await d.tokens.getRefresh()) || !isBootstrapped(d.db)) return 'skipped';
    await d.auth.restoreDevice();
    if (!d.auth.deviceId) return 'skipped';
    if (!(await d.api.refresh())) { logger.warn('background', 'No se pudo renovar la sesión'); return 'failed'; }
    const r = await d.engine.run();
    logger.info('background', `push ${r.pushed} · aplicadas ${r.applied} · rechazadas ${r.rejected}`);
    return r.offline ? 'failed' : 'success';
  } catch (e) {
    logger.warn('background', e instanceof Error ? e.message : 'error');
    return 'failed';
  }
}
