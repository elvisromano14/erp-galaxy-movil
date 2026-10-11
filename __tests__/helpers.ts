import type { TokenPair, TokenStore } from '../src/core/api/ApiClient';

export const memoryTokens = (initial?: string): TokenStore & { refresh: string | null; cleared: number } => {
  const store = {
    refresh: initial ?? null as string | null, cleared: 0,
    async getRefresh() { return store.refresh; },
    async save(p: TokenPair) { store.refresh = p.refreshToken; },
    async clear() { store.refresh = null; store.cleared++; },
  };
  return store;
};

type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/** fetch simulado: enruta por `METODO /ruta` y registra las llamadas. */
export function fakeFetch(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const calls: { method: string; path: string; headers: Record<string, string>; body?: any }[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, path, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${method} ${path}`];
    if (!r) throw new Error(`ruta no simulada: ${method} ${path}`);
    const out = typeof r === 'function' ? await r(url, init) : r;
    const status = out.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => out.body ?? {} } as Response;
  }) as typeof fetch;
  return { impl, calls };
}
