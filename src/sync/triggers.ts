import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import type { SessionService } from '../core/session/SessionService';

/**
 * Disparadores de sincronización (plan §7.1): volver a primer plano y recuperar la red. (Tras guardar, la pantalla llama a
 * `session.requestSync()`; el botón manual llama a `session.sync()`; la tarea en segundo plano llega en M6.)
 * Devuelve la función para desuscribirse.
 */
export function startSyncTriggers(session: SessionService): () => void {
  let wasOffline = false;
  const net = NetInfo.addEventListener((s) => {
    const online = !!s.isConnected && s.isInternetReachable !== false;
    if (online && wasOffline) session.requestSync(1000);
    wasOffline = !online;
  });
  const app = AppState.addEventListener('change', (st) => { if (st === 'active') session.requestSync(500); });
  return () => { net(); app.remove(); };
}
