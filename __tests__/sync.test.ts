import { ApiClient } from '../src/core/api/ApiClient';
import type { PullEntity, PullPage } from '../src/core/api/contract';
import { backoffMs, nextAttemptAt } from '../src/sync/backoff';
import { pullEntity, type PullStore } from '../src/sync/pull';
import { fakeFetch, memoryTokens } from './helpers';

describe('backoff', () => {
  it('escala 5 s → 30 min con jitter ±20 % y se detiene en el tope', () => {
    expect(backoffMs(1, () => 0.5)).toBe(5_000);
    expect(backoffMs(2, () => 0.5)).toBe(15_000);
    expect(backoffMs(6, () => 0.5)).toBe(1_800_000);
    expect(backoffMs(50, () => 0.5)).toBe(1_800_000);
    expect(backoffMs(1, () => 0)).toBe(4_000); expect(backoffMs(1, () => 1)).toBe(6_000);
    expect(nextAttemptAt(1, Date.UTC(2026, 0, 1), () => 0.5)).toBe('2026-01-01T00:00:05.000Z');
  });
});

describe('pullEntity', () => {
  const memStore = (initial: string | null = null) => {
    const s = { cursor: initial as string | null, pages: [] as PullPage[], async getCursor(_e: PullEntity) { return s.cursor; }, async applyPage(p: PullPage, next: string | null) { s.pages.push(p); s.cursor = next; } };
    return s satisfies PullStore & Record<string, unknown>;
  };
  const page = (items: unknown[], next: string | null, hasMore: boolean): PullPage => ({ entity: 'customers', items: items as never, nextCursor: next, hasMore, fullRefresh: false, serverTime: 'x' });

  it('recorre todas las páginas por cursor, guarda el cursor en cada lote y solo solapa en la primera', async () => {
    const queries: Record<string, string>[] = [];
    const f = fakeFetch({ 'GET /sync/pull': (u) => {
      const q = Object.fromEntries(u.searchParams); queries.push(q);
      if (!q.cursor || q.cursor === 'c0') return { body: { data: page([1, 2], 'c1', true) } };
      if (q.cursor === 'c1') return { body: { data: page([3, 4], 'c2', true) } };
      return { body: { data: page([5], 'c3', false) } };
    } });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl });
    const store = memStore('c0');
    const n = await pullEntity(api, store, 'customers', { limit: 2, overlapSeconds: 60 });
    expect(n).toBe(5); expect(store.cursor).toBe('c3');
    expect(queries.map((q) => q.overlapSeconds)).toEqual(['60', '0', '0']);
    expect(queries.every((q) => q.entity === 'customers' && q.limit === '2')).toBe(true);
  });

  it('sin cursor previo (bootstrap) no pide solape', async () => {
    const f = fakeFetch({ 'GET /sync/pull': (u) => ({ body: { data: page([1], 'c1', false) } }) });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl });
    await pullEntity(api, memStore(), 'customers');
    expect(f.calls[0].path).toBe('/sync/pull');
  });

  it('un corte a mitad conserva el cursor del último lote aplicado (reanudable)', async () => {
    let call = 0;
    const f = fakeFetch({ 'GET /sync/pull': () => { call++; if (call === 1) return { body: { data: page([1], 'c1', true) } }; return { status: 503, body: { error: 'X' } }; } });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl });
    const store = memStore();
    await expect(pullEntity(api, store, 'customers')).rejects.toMatchObject({ status: 503 });
    expect(store.cursor).toBe('c1');
  });

  it('se puede cancelar entre páginas', async () => {
    const f = fakeFetch({ 'GET /sync/pull': () => ({ body: { data: page([1], 'c1', true) } }) });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl });
    const signal = { cancelled: false };
    const n = await pullEntity(api, memStore(), 'customers', { signal, onProgress: () => { signal.cancelled = true; } });
    expect(n).toBe(1); expect(f.calls).toHaveLength(1);
  });
});
