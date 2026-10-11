import type { ApiClient } from '../core/api/ApiClient';
import { PULL_ORDER, type PullEntity } from '../core/api/contract';
import { META, getMeta, setMeta } from '../db/meta';
import type { AppDb } from '../db/types';
import { pullAll } from './pull';
import { SqlitePullStore } from './SqlitePullStore';

export interface BootstrapProgress { entity: PullEntity; /** filas descargadas de esta entidad */ loaded: number; /** posición de la entidad (1…n) */ index: number; total: number }

export const isBootstrapped = (db: AppDb) => getMeta(db, META.bootstrapDoneAt) !== null;

/**
 * Descarga inicial del catálogo (productos, clientes, precios, existencias…). Reanudable: el cursor de cada entidad se guarda
 * con cada lote, así que si la app se cierra o se corta la red, al reintentar continúa donde quedó. Cancelable con `signal`.
 * Devuelve las filas descargadas por entidad, o `null` si se canceló.
 */
export async function runBootstrap(
  api: ApiClient, db: AppDb, o: { onProgress?: (p: BootstrapProgress) => void; signal?: { cancelled: boolean }; limit?: number } = {},
): Promise<Record<string, number> | null> {
  const store = new SqlitePullStore(db);
  const out = await pullAll(api, store, {
    limit: o.limit, signal: o.signal,
    onProgress: (entity, loaded) => o.onProgress?.({ entity, loaded, index: PULL_ORDER.indexOf(entity) + 1, total: PULL_ORDER.length }),
  });
  if (o.signal?.cancelled) return null;
  const now = new Date().toISOString();
  setMeta(db, META.bootstrapDoneAt, now);
  setMeta(db, META.lastSyncAt, now);
  return out;
}

/** Sincronización incremental (pull): relee una ventana de 60 s en la primera página de cada entidad. */
export async function syncNow(api: ApiClient, db: AppDb, o: { signal?: { cancelled: boolean } } = {}): Promise<Record<string, number>> {
  const out = await pullAll(api, new SqlitePullStore(db), { overlapSeconds: 60, signal: o.signal });
  setMeta(db, META.lastSyncAt, new Date().toISOString());
  return out;
}
