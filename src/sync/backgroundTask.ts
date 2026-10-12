import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { POLICY } from '../core/config/policy';
import { api, auth, db, engine } from '../core/services';
import { secureTokenStore } from '../core/auth/secureStorage';
import { runBackgroundSync } from './backgroundSync';

export const BACKGROUND_SYNC_TASK = 'erp-background-sync';

// La definición debe ejecutarse al cargar la app (módulo importado desde el layout raíz).
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  const r = await runBackgroundSync({ api, auth, tokens: secureTokenStore, engine, db });
  return r === 'failed' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

/** Registra la tarea periódica (cada ≥15 min; en fabricantes con ahorro agresivo de batería puede no ejecutarse). */
export async function registerBackgroundSync(): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: POLICY.backgroundIntervalMinutes });
  } catch { /* sin soporte en este dispositivo: se sincroniza al abrir */ }
}
