import type { ApiClient, TokenPair, TokenStore } from '../api/ApiClient';
import type { DeviceInfo } from '../api/contract';

export interface CompanyChoice { id: string; rif: string; legalName: string; tradeName: string | null; organizationName?: string }
export interface LoginResult {
  user: { id: string; email: string; fullName: string; isSuperAdmin: boolean };
  companies: CompanyChoice[];
  companyId: string | null;
  requiresCompanySelection: boolean;
}

/** Identidad estable del dispositivo en el servidor: se genera una vez y vive en el almacenamiento seguro. */
export interface DeviceStore {
  getKey(): Promise<string | null>;
  saveKey(key: string): Promise<void>;
  getDeviceId(): Promise<string | null>;
  saveDeviceId(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Login → empresa → registro del dispositivo (ver plan M1). El primer acceso requiere red; después solo el PIN/huella local. */
export class AuthService {
  deviceId: string | null = null;

  constructor(
    private readonly api: ApiClient, private readonly tokens: TokenStore, private readonly device: DeviceStore,
    private readonly opts: { deviceName: string; newDeviceKey: () => string; appVersion: string; platform?: 'android' | 'ios' },
  ) {}

  async restoreDevice() { this.deviceId = await this.device.getDeviceId(); return this.deviceId; }

  async login(email: string, password: string): Promise<LoginResult> {
    const r = await this.api.post<LoginResult & TokenPair>('/auth/login', { email: email.trim(), password }, { auth: false });
    await this.keep(r);
    return { user: r.user, companies: r.companies, companyId: r.companyId, requiresCompanySelection: r.requiresCompanySelection };
  }

  async selectCompany(companyId: string) {
    const r = await this.api.post<TokenPair & { companyId: string }>('/auth/select-company', { companyId });
    await this.keep(r);
    return r.companyId;
  }

  /** Idempotente: el mismo `deviceKey` siempre devuelve el mismo dispositivo. */
  async registerDevice(): Promise<DeviceInfo> {
    let key = await this.device.getKey();
    if (!key) { key = this.opts.newDeviceKey(); await this.device.saveKey(key); }
    const d = await this.api.post<DeviceInfo>('/devices/register', { deviceKey: key, name: this.opts.deviceName, platform: this.opts.platform ?? 'android', appVersion: this.opts.appVersion });
    this.deviceId = d.id;
    await this.device.saveDeviceId(d.id);
    return d;
  }

  async logout() {
    try { await this.api.post('/auth/logout', { refreshToken: await this.tokens.getRefresh() }); } catch { /* sin red: se cierra localmente */ }
    this.api.setAccessToken(null);
    await this.tokens.clear();
  }

  private async keep(pair: TokenPair) {
    this.api.setAccessToken(pair.accessToken);
    await this.tokens.save(pair);
  }
}
