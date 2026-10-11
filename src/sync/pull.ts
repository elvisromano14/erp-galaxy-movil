import type { ApiClient } from '../core/api/ApiClient';
import type { PullEntity, PullPage } from '../core/api/contract';
import { PULL_ORDER } from '../core/api/contract';

/** Persistencia local que necesita el pull: aplica un lote y guarda el cursor en UNA transacción (la implementa db/). */
export interface PullStore {
  getCursor(entity: PullEntity): Promise<string | null>;
  applyPage(page: PullPage, nextCursor: string | null): Promise<void>;
}

export interface PullOptions { limit?: number; overlapSeconds?: number; onProgress?: (entity: PullEntity, loaded: number) => void; signal?: { cancelled: boolean } }

/**
 * Descarga una entidad completa página por página. La primera página de cada sincronización relee los últimos
 * `overlapSeconds` (transacciones del servidor que confirmaron tarde); el resto avanza por cursor estricto.
 * Reanudable: el cursor se guarda con cada lote, así que un corte a mitad continúa donde quedó.
 */
export async function pullEntity(api: ApiClient, store: PullStore, entity: PullEntity, o: PullOptions = {}): Promise<number> {
  let cursor = await store.getCursor(entity);
  let first = true;
  let loaded = 0;
  for (;;) {
    if (o.signal?.cancelled) return loaded;
    const page = await api.get<PullPage>('/sync/pull', {
      query: { entity, limit: o.limit ?? 1000, cursor: cursor ?? undefined, overlapSeconds: first && cursor ? (o.overlapSeconds ?? 60) : 0 },
    });
    // fullRefresh: el servidor envía todo en una sola respuesta (cursor nulo).
    await store.applyPage(page, page.nextCursor ?? cursor);
    loaded += page.items.length;
    o.onProgress?.(entity, loaded);
    first = false;
    if (!page.hasMore || !page.nextCursor) return loaded;
    cursor = page.nextCursor;
  }
}

/** Pull completo en el orden que exige el plan (ajustes → impuestos → … → documentos). Un error detiene el ciclo y lo ve el llamador. */
export async function pullAll(api: ApiClient, store: PullStore, o: PullOptions = {}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const entity of PULL_ORDER) out[entity] = await pullEntity(api, store, entity, o);
  return out;
}
