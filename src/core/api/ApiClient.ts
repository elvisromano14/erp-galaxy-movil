import { ApiError } from './errors';

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn?: number }

/** Almacén de tokens: en la app es `expo-secure-store` (Keystore de Android); en las pruebas, uno en memoria. */
export interface TokenStore {
  getRefresh(): Promise<string | null>;
  save(pair: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  appVersion: string;
  tokens: TokenStore;
  /** Id del dispositivo registrado (cabecera X-Device-Id en sync/*). */
  getDeviceId?: () => string | null;
  /** Tamaño de la cola de salida: se reporta al servidor en cada petición (monitoreo de colas largas desde la oficina). */
  getQueueSize?: () => number | null;
  /** Se invoca cuando no hay forma de renovar la sesión (refresh inválido/revocado). */
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** false = sin Authorization (login, refresh, app/config). */
  auth?: boolean;
  /** Cabeceras extra. */
  headers?: Record<string, string>;
}

/**
 * Cliente HTTP del ERP (`/api/v1`). Responsabilidades: cabeceras (versión de la app, dispositivo), desenvolver `{ data }`,
 * errores tipados y renovación de sesión con *single-flight* (varias peticiones con 401 comparten un solo refresh).
 * La UI no lo usa directamente: pasa por los servicios (ver docs/PLAN-MOVIL.md §4).
 */
export class ApiClient {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.f = opts.fetchImpl ?? fetch;
  }

  setAccessToken(token: string | null) { this.access = token; }
  get hasAccessToken() { return this.access !== null; }

  async get<T>(path: string, o: RequestOptions = {}) { return this.request<T>('GET', path, o); }
  async post<T>(path: string, body?: unknown, o: RequestOptions = {}) { return this.request<T>('POST', path, { ...o, body }); }

  async request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const res = await this.send(method, path, o);
    if (res.status === 401 && o.auth !== false && (await this.refresh())) {
      return this.parse<T>(await this.send(method, path, o));
    }
    return this.parse<T>(res);
  }

  /** Renueva la sesión una sola vez aunque lleguen varias respuestas 401 a la vez. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.opts.tokens.getRefresh();
    if (!refreshToken) return this.expire();
    try {
      const res = await this.send('POST', '/auth/refresh', { auth: false, body: { refreshToken } });
      if (res.status === 401 || res.status === 403) return this.expire();
      const pair = await this.parse<TokenPair>(res);
      this.access = pair.accessToken;
      await this.opts.tokens.save(pair);
      return true;
    } catch (e) {
      // Sin red: no es un cierre de sesión; la petición original falla como error de red y se reintentará.
      if (e instanceof ApiError && e.isRetryable) return false;
      return this.expire();
    }
  }

  private async expire(): Promise<false> {
    this.access = null;
    await this.opts.tokens.clear();
    this.opts.onSessionExpired?.();
    return false;
  }

  private async send(method: string, path: string, o: RequestOptions): Promise<Response> {
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/, '')}/api/v1${path}`);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json', 'x-app-version': this.opts.appVersion, ...o.headers };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.auth !== false && this.access) headers.authorization = `Bearer ${this.access}`;
    const device = this.opts.getDeviceId?.();
    if (device) headers['x-device-id'] = device;
    const queue = this.opts.getQueueSize?.();
    if (device && queue !== null && queue !== undefined) headers['x-queue-size'] = String(queue);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      return await this.f(url.toString(), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error && e.name === 'AbortError' ? 'Tiempo de espera agotado' : 'Sin conexión con el servidor');
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    let json: any = null;
    try { json = await res.json(); } catch { /* cuerpo vacío o no JSON */ }
    if (!res.ok) throw new ApiError(res.status, json?.error ?? 'UNKNOWN', json?.message ?? `Error ${res.status}`, json?.details ?? []);
    return (json && 'data' in json ? json.data : json) as T;
  }
}
