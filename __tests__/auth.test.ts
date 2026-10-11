import { ApiClient } from '../src/core/api/ApiClient';
import { AuthService, type DeviceStore } from '../src/core/auth/AuthService';
import { fakeFetch, memoryTokens } from './helpers';

const memoryDevice = (): DeviceStore & { key: string | null; id: string | null } => {
  const s = { key: null as string | null, id: null as string | null,
    async getKey() { return s.key; }, async saveKey(k: string) { s.key = k; },
    async getDeviceId() { return s.id; }, async saveDeviceId(i: string) { s.id = i; }, async clear() { s.id = null; } };
  return s;
};

describe('AuthService', () => {
  it('login con una sola empresa: guarda tokens y no pide elegir empresa', async () => {
    const f = fakeFetch({ 'POST /auth/login': { body: { data: { user: { id: 'u', email: 'a@b.c', fullName: 'A', isSuperAdmin: false }, companies: [{ id: 'c1' }], companyId: 'c1', requiresCompanySelection: false, accessToken: 'acc', refreshToken: 'ref' } } } });
    const tokens = memoryTokens(); const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens, fetchImpl: f.impl });
    const auth = new AuthService(api, tokens, memoryDevice(), { deviceName: 'Pixel', newDeviceKey: () => 'key-123456789012345678', appVersion: '1' });
    const r = await auth.login(' a@b.c ', 'secreto');
    expect(r).toMatchObject({ companyId: 'c1', requiresCompanySelection: false });
    expect(tokens.refresh).toBe('ref'); expect(api.hasAccessToken).toBe(true);
    expect(f.calls[0].body).toEqual({ email: 'a@b.c', password: 'secreto' });
    expect(f.calls[0].headers.authorization).toBeUndefined();
  });

  it('el registro del dispositivo es idempotente: reutiliza la misma deviceKey', async () => {
    const f = fakeFetch({ 'POST /devices/register': { status: 201, body: { data: { id: 'dev-1', deviceCode: 'D01', name: 'Pixel', platform: 'android', appVersion: '1' } } } });
    const tokens = memoryTokens(); const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens, fetchImpl: f.impl });
    const device = memoryDevice(); let n = 0;
    const auth = new AuthService(api, tokens, device, { deviceName: 'Pixel', newDeviceKey: () => `key-${++n}-0000000000000000`, appVersion: '1' });
    expect((await auth.registerDevice()).deviceCode).toBe('D01');
    await auth.registerDevice();
    expect(n).toBe(1); // la clave se genera una sola vez
    expect(f.calls[0].body.deviceKey).toBe(f.calls[1].body.deviceKey);
    expect(device.id).toBe('dev-1'); expect(auth.deviceId).toBe('dev-1');
  });

  it('logout limpia la sesión aunque no haya red', async () => {
    const f = fakeFetch({});
    const tokens = memoryTokens('ref'); const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens, fetchImpl: f.impl });
    const auth = new AuthService(api, tokens, memoryDevice(), { deviceName: 'P', newDeviceKey: () => 'k'.repeat(20), appVersion: '1' });
    api.setAccessToken('acc');
    await auth.logout();
    expect(tokens.refresh).toBeNull(); expect(api.hasAccessToken).toBe(false);
  });
});
