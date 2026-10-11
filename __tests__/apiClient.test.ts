import { ApiClient } from '../src/core/api/ApiClient';
import { ApiError } from '../src/core/api/errors';
import { fakeFetch, memoryTokens } from './helpers';

const mk = (routes: Parameters<typeof fakeFetch>[0], tokens = memoryTokens('r1'), extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) => {
  const f = fakeFetch(routes);
  const expired = jest.fn();
  const api = new ApiClient({ baseUrl: 'https://erp.test/', appVersion: '1.2.3', tokens, fetchImpl: f.impl, onSessionExpired: expired, ...extra });
  return { api, f, tokens, expired };
};

describe('ApiClient', () => {
  it('desenvuelve { data }, envía versión y token, y arma la query sin valores indefinidos', async () => {
    const { api, f } = mk({ 'GET /customers': { body: { data: [{ id: 1 }] } } });
    api.setAccessToken('acc');
    expect(await api.get('/customers', { query: { limit: 5, q: undefined } })).toEqual([{ id: 1 }]);
    expect(f.calls[0].headers).toMatchObject({ authorization: 'Bearer acc', 'x-app-version': '1.2.3' });
  });

  it('envía X-Device-Id cuando hay dispositivo y omite Authorization con auth:false', async () => {
    const { api, f } = mk({ 'GET /app/config': { body: { data: {} } } }, memoryTokens(), { getDeviceId: () => 'dev-1' });
    api.setAccessToken('acc');
    await api.get('/app/config', { auth: false });
    expect(f.calls[0].headers['x-device-id']).toBe('dev-1');
    expect(f.calls[0].headers.authorization).toBeUndefined();
  });

  it('errores tipados: código, mensaje y banderas', async () => {
    const { api } = mk({
      'GET /a': { status: 403, body: { error: 'DEVICE_REVOKED', message: 'Revocado' } },
      'GET /b': { status: 503, body: { error: 'X', message: 'caído' } },
    });
    const e1 = await api.get('/a').catch((e) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect(e1).toMatchObject({ status: 403, code: 'DEVICE_REVOKED', blocksApp: true, isRetryable: false });
    expect(await api.get('/b').catch((e) => e)).toMatchObject({ isRetryable: true, blocksApp: false });
  });

  it('un fallo de red es un ApiError reintentable (status 0)', async () => {
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: (async () => { throw new TypeError('Network request failed'); }) as typeof fetch });
    expect(await api.get('/x').catch((e) => e)).toMatchObject({ status: 0, code: 'NETWORK_ERROR', isNetwork: true, isRetryable: true });
  });

  it('401 → renueva la sesión una vez, guarda el nuevo refresh token y repite la petición', async () => {
    let first = true;
    const { api, f, tokens } = mk({
      'GET /me': () => (first ? ((first = false), { status: 401, body: { error: 'UNAUTHORIZED' } }) : { body: { data: { ok: true } } }),
      'POST /auth/refresh': { body: { data: { accessToken: 'new', refreshToken: 'r2' } } },
    });
    expect(await api.get('/me')).toEqual({ ok: true });
    expect(tokens.refresh).toBe('r2');
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /me', 'POST /auth/refresh', 'GET /me']);
    expect(f.calls[2].headers.authorization).toBe('Bearer new');
    expect(f.calls[1].body).toEqual({ refreshToken: 'r1' });
  });

  it('varias peticiones con 401 simultáneas comparten UN solo refresh (single-flight)', async () => {
    const seen = new Set<string>();
    const { api, f } = mk({
      'GET /a': (_u, init) => ((init.headers as Record<string, string>).authorization === 'Bearer new' ? { body: { data: 'a' } } : { status: 401, body: {} }),
      'GET /b': (_u, init) => ((init.headers as Record<string, string>).authorization === 'Bearer new' ? { body: { data: 'b' } } : { status: 401, body: {} }),
      'POST /auth/refresh': async () => { seen.add('r'); await new Promise((r) => setTimeout(r, 10)); return { body: { data: { accessToken: 'new', refreshToken: 'r2' } } }; },
    });
    api.setAccessToken('old');
    expect(await Promise.all([api.get('/a'), api.get('/b')])).toEqual(['a', 'b']);
    expect(f.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('refresh rechazado → cierra la sesión local y avisa (la cola de la app se conserva fuera del cliente)', async () => {
    const { api, tokens, expired } = mk({ 'GET /me': { status: 401, body: {} }, 'POST /auth/refresh': { status: 401, body: { error: 'REFRESH_INVALID' } } });
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(tokens.cleared).toBe(1); expect(expired).toHaveBeenCalledTimes(1); expect(api.hasAccessToken).toBe(false);
  });

  it('sin red durante el refresh NO cierra la sesión', async () => {
    let n = 0;
    const f = fakeFetch({ 'GET /me': { status: 401, body: {} } });
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).includes('/auth/refresh')) { n++; throw new TypeError('offline'); } return f.impl(input, init); }) as typeof fetch;
    const tokens = memoryTokens('r1'); const expired = jest.fn();
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens, fetchImpl: impl, onSessionExpired: expired });
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(n).toBe(1); expect(expired).not.toHaveBeenCalled(); expect(tokens.refresh).toBe('r1');
  });
});
