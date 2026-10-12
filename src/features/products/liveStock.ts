import type { ApiClient } from '../../core/api/ApiClient';
import type { LiveStock } from '../../core/api/contract';

/** Existencia en vivo (requiere conexión). El servidor no incluye costos. */
export const fetchLiveStock = (api: ApiClient, productId: string) => api.get<LiveStock>(`/sync/stock/${productId}`);
