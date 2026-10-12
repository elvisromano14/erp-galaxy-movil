import { count, inArray } from 'drizzle-orm';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ApiClient, TokenStore } from '../api/ApiClient';
import type { AppConfig } from '../api/contract';
import { ApiError } from '../api/errors';
import type { AuthService, CompanyChoice, Profile } from '../auth/AuthService';
import type { Biometric } from '../auth/native';
import { MAX_PIN_ATTEMPTS, type PinLock, shouldLock } from '../auth/PinLock';
import { META, getJson, getMeta, setJson, setMeta } from '../../db/meta';
import { wipeReplica } from '../../db/replica';
import { outbox } from '../../db/schema';
import type { AppDb } from '../../db/types';
import { type BootstrapProgress, isBootstrapped, runBootstrap } from '../../sync/bootstrap';
import type { SyncEngine } from '../../sync/SyncEngine';
import { counts } from '../../db/repositories/outbox';

export type SessionStatus = 'booting' | 'anonymous' | 'needs-company' | 'needs-pin' | 'locked' | 'needs-bootstrap' | 'ready' | 'blocked';
export type BlockReason = 'DEVICE_REVOKED' | 'UPGRADE_REQUIRED';

export interface SessionState {
  status: SessionStatus;
  companies: CompanyChoice[];
  profile: Profile | null;
  permissions: string[];
  deviceCode: string | null;
  blocked: { reason: BlockReason; message: string } | null;
  /** Mensaje de mantenimiento del servidor (no bloquea: se muestra como aviso). */
  maintenance: string | null;
  /** false = sin conexión al servidor (se puede trabajar con los datos locales). */
  online: boolean;
  bootstrap: BootstrapProgress | null;
  busy: boolean;
  error: string | null;
  lastSyncAt: string | null;
  /** Cola de salida: pendientes de envío, rechazadas y en revisión. */
  queue: { pending: number; rejected: number; review: number };
}

const initial: SessionState = {
  status: 'booting', companies: [], profile: null, permissions: [], deviceCode: null, blocked: null, maintenance: null, online: true,
  bootstrap: null, busy: false, error: null, lastSyncAt: null, queue: { pending: 0, rejected: 0, review: 0 },
};

export interface SessionDeps {
  api: ApiClient; auth: AuthService; tokens: TokenStore; db: AppDb; pin: PinLock; biometric: Biometric;
  engine: SyncEngine;
  appVersion: string; versionLt: (a: string, b: string) => boolean;
  /** Inactividad en segundo plano tras la cual se pide el PIN (ms). */
  lockTimeoutMs?: number; now?: () => number;
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error desconocido');

/**
 * Máquina de estados de acceso (plan M1): arranque → login → empresa → dispositivo → PIN → descarga inicial → listo,
 * con bloqueo por inactividad, dispositivo revocado y versión obsoleta. La cola de salida (outbox) NUNCA se borra aquí.
 */
export class SessionService {
  readonly store: StoreApi<SessionState> = createStore<SessionState>(() => ({ ...initial }));
  private backgroundedAt: number | null = null;
  private cancel = { cancelled: false };
  private readonly now: () => number;

  constructor(private readonly d: SessionDeps) {
    this.now = d.now ?? Date.now;
    // Si no hay forma de renovar la sesión, se pide iniciar sesión de nuevo (datos y cola locales intactos).
    // (El ApiClient llama a este gancho; se conecta en services.ts / pruebas con `onSessionExpired`.)
  }

  get state() { return this.store.getState(); }
  private set(p: Partial<SessionState>) { this.store.setState(p); }

  /** Gancho para `ApiClient.onSessionExpired`. */
  onSessionExpired = () => {
    if (this.state.status === 'anonymous' || this.state.status === 'booting') return;
    this.set({ status: 'anonymous', error: 'Su sesión venció: inicie sesión de nuevo. Sus pendientes se conservan.' });
  };

  // ───────────────── arranque ─────────────────
  async start(): Promise<void> {
    this.set({ ...initial });
    const online = await this.checkConfig();
    await this.d.auth.restoreDevice();
    if (this.state.status === 'blocked') return;
    const hasSession = !!(await this.d.tokens.getRefresh());
    const ready = this.d.auth.deviceId && getMeta(this.d.db, META.companyId) && getJson<string[]>(this.d.db, META.permissions);
    if (!hasSession || !ready) { this.set({ status: 'anonymous', online }); return; }
    const profile = getJson<Profile>(this.d.db, 'profile');
    this.set({ profile, permissions: getJson<string[]>(this.d.db, META.permissions) ?? [], deviceCode: getMeta(this.d.db, META.deviceCode), lastSyncAt: getMeta(this.d.db, META.lastSyncAt), online });
    this.refreshQueue();
    if (!(await this.d.pin.isSet())) { this.set({ status: 'needs-pin' }); return; }
    this.set({ status: 'locked' });
  }

  /** Versiones y mantenimiento (sin red no se bloquea: se opera con los datos locales). */
  private async checkConfig(): Promise<boolean> {
    try {
      const cfg = await this.d.api.get<AppConfig>('/app/config', { auth: false });
      if (this.d.versionLt(this.d.appVersion, cfg.minAppVersion)) {
        this.set({ status: 'blocked', blocked: { reason: 'UPGRADE_REQUIRED', message: `Actualice la aplicación (versión mínima ${cfg.minAppVersion}). Sus pendientes se conservan.` } });
      }
      this.set({ maintenance: cfg.maintenance?.message ?? null });
      return true;
    } catch { return false; }
  }

  // ───────────────── login y alta del dispositivo ─────────────────
  async login(email: string, password: string): Promise<void> {
    this.set({ busy: true, error: null });
    try {
      const r = await this.d.auth.login(email, password);
      if (r.requiresCompanySelection) { this.set({ status: 'needs-company', companies: r.companies, busy: false }); return; }
      await this.completeSetup();
    } catch (e) { this.fail(e); }
  }

  async chooseCompany(companyId: string): Promise<void> {
    this.set({ busy: true, error: null });
    try { await this.d.auth.selectCompany(companyId); await this.completeSetup(); } catch (e) { this.fail(e); }
  }

  private async completeSetup(): Promise<void> {
    const device = await this.d.auth.registerDevice();
    const profile = await this.d.auth.loadProfile();
    const newCompany = profile.company?.id ?? null;
    const previous = getMeta(this.d.db, META.companyId);
    if (previous && newCompany && previous !== newCompany) {
      // Otra empresa en el mismo teléfono: no se mezclan datos; los pendientes de la anterior deben sincronizarse antes.
      if (this.pendingCount() > 0) throw new Error('Hay operaciones pendientes de otra empresa en este teléfono: sincronícelas con su usuario anterior antes de cambiar de empresa.');
      wipeReplica(this.d.db);
    }
    if (newCompany) setMeta(this.d.db, META.companyId, newCompany);
    setMeta(this.d.db, META.deviceCode, device.deviceCode);
    setJson(this.d.db, META.permissions, profile.permissions);
    setJson(this.d.db, 'profile', profile);
    this.set({ profile, permissions: profile.permissions, deviceCode: device.deviceCode, busy: false, online: true });
    this.set({ status: (await this.d.pin.isSet()) ? this.afterUnlock() : 'needs-pin' });
  }

  private fail(e: unknown) {
    if (e instanceof ApiError && e.code === 'DEVICE_REVOKED') { this.blockRevoked(); return; }
    this.set({ busy: false, error: msg(e) });
  }

  // ───────────────── PIN y bloqueo ─────────────────
  async setPin(pin: string): Promise<void> {
    try { await this.d.pin.setPin(pin); this.set({ status: this.afterUnlock(), error: null }); } catch (e) { this.set({ error: msg(e) }); }
  }

  async unlock(pin: string): Promise<void> {
    const r = await this.d.pin.verify(pin);
    if (r === 'OK') { this.set({ error: null }); this.proceedAfterUnlock(); return; }
    if (r === 'LOCKED_OUT') {
      await this.d.pin.clear();
      await this.d.auth.logout();
      this.set({ status: 'anonymous', error: `Superó ${MAX_PIN_ATTEMPTS} intentos: inicie sesión de nuevo. Sus pendientes se conservan.` });
      return;
    }
    this.set({ error: `PIN incorrecto (${await this.d.pin.attemptsLeft()} intentos restantes)` });
  }

  async unlockWithBiometric(): Promise<void> {
    if (!(await this.d.biometric.isAvailable())) return;
    if (await this.d.biometric.authenticate('Desbloquear ERP Ventas')) { this.set({ error: null }); this.proceedAfterUnlock(); }
  }

  private afterUnlock(): SessionStatus { return isBootstrapped(this.d.db) ? 'ready' : 'needs-bootstrap'; }

  private proceedAfterUnlock() {
    this.set({ status: this.afterUnlock() });
    void this.refreshSession();
  }

  /** Recupera el access token en segundo plano; sin red se sigue operando con los datos locales. */
  async refreshSession(): Promise<void> {
    try { const ok = await this.d.api.refresh(); this.set({ online: ok }); } catch { this.set({ online: false }); }
  }

  /** Llamar al pasar la app a segundo plano / de vuelta a primer plano. */
  onBackground() { this.backgroundedAt = this.now(); }
  onForeground() {
    if (this.state.status === 'ready' && shouldLock(this.backgroundedAt, this.now(), this.d.lockTimeoutMs ?? 5 * 60_000)) this.set({ status: 'locked' });
    this.backgroundedAt = null;
  }
  lock() { if (this.state.status === 'ready') this.set({ status: 'locked' }); }

  // ───────────────── descarga inicial y sincronización ─────────────────
  async bootstrap(): Promise<void> {
    this.cancel = { cancelled: false };
    this.set({ busy: true, error: null, bootstrap: null });
    try {
      const out = await runBootstrap(this.d.api, this.d.db, { signal: this.cancel, onProgress: (p) => this.set({ bootstrap: p }) });
      if (out === null) { this.set({ busy: false, error: 'Descarga cancelada: podrá continuarla cuando quiera.' }); return; }
      this.set({ status: 'ready', busy: false, bootstrap: null, lastSyncAt: getMeta(this.d.db, META.lastSyncAt), online: true });
    } catch (e) { this.syncFailed(e); }
  }

  cancelBootstrap() { this.cancel.cancelled = true; }

  /** Ciclo completo: envía la cola (push) y luego descarga cambios (pull). Un solo ciclo a la vez. */
  async sync(): Promise<void> {
    this.set({ busy: true, error: null });
    try {
      const r = await this.d.engine.run();
      this.refreshQueue();
      // Si la sesión venció durante el ciclo, ya se pidió iniciar sesión de nuevo (`onSessionExpired`): no se pisa ese aviso.
      if (this.state.status === 'anonymous') { this.set({ busy: false }); return; }
      if (r.offline) { this.set({ busy: false, online: false, error: 'Sin conexión con el servidor: se reintentará. Puede seguir trabajando con los datos locales.' }); return; }
      this.set({ busy: false, online: true, lastSyncAt: getMeta(this.d.db, META.lastSyncAt) });
    } catch (e) { this.refreshQueue(); this.syncFailed(e); }
  }

  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pide una sincronización con *debounce* (2 s): tras guardar, al volver la red o al abrir la app. */
  requestSync(delayMs = 2000) {
    if (this.state.status !== 'ready') return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; if (this.state.status === 'ready' && !this.state.busy && !this.d.engine.isRunning) void this.sync(); }, delayMs);
  }

  /** Recalcula los contadores de la cola (después de guardar algo o de sincronizar). */
  refreshQueue() {
    const c = counts(this.d.db);
    this.set({ queue: { pending: c.PENDING + c.SENDING, rejected: c.REJECTED, review: c.REVIEW } });
  }

  private syncFailed(e: unknown) {
    if (e instanceof ApiError) {
      if (e.code === 'DEVICE_REVOKED') { this.blockRevoked(); return; }
      if (e.code === 'UPGRADE_REQUIRED') { this.set({ status: 'blocked', busy: false, blocked: { reason: 'UPGRADE_REQUIRED', message: e.message } }); return; }
      if (e.status === 401) {
        // Sesión vencida: ya la atendió `onSessionExpired` (pide login). Si no, es que no hubo red para renovarla.
        if (this.state.status === 'anonymous') { this.set({ busy: false }); return; }
        this.set({ busy: false, online: false, error: 'Sin conexión con el servidor: se reintentará. Puede seguir trabajando con los datos locales.' }); return;
      }
      if (e.isRetryable) { this.set({ busy: false, online: false, error: 'Sin conexión con el servidor: se reintentará. Puede seguir trabajando con los datos locales.' }); return; }
    }
    this.set({ busy: false, error: msg(e) });
  }

  /**
   * Para llamadas sueltas a la API (p. ej. existencia en vivo): si el error bloquea la app (dispositivo revocado, versión obsoleta)
   * aplica el bloqueo; devuelve siempre un mensaje comprensible para mostrar.
   */
  reportError(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.code === 'DEVICE_REVOKED') { this.blockRevoked(); return e.message; }
      if (e.code === 'UPGRADE_REQUIRED') { this.set({ status: 'blocked', blocked: { reason: 'UPGRADE_REQUIRED', message: e.message } }); return e.message; }
      if (e.status === 401 && this.state.status === 'anonymous') return 'Su sesión venció: inicie sesión de nuevo.';
      if (e.isRetryable || e.status === 401) { this.set({ online: false }); return 'Sin conexión con el servidor.'; }
    }
    return msg(e);
  }

  /** Dispositivo revocado: se borra la réplica; la cola de salida se conserva para que administración pueda rehabilitar el equipo. */
  private blockRevoked() {
    wipeReplica(this.d.db);
    this.set({ status: 'blocked', busy: false, blocked: { reason: 'DEVICE_REVOKED', message: 'Este dispositivo fue revocado por la administración. Sus pendientes se conservan.' } });
  }

  // ───────────────── cierre de sesión ─────────────────
  pendingCount(): number {
    return this.d.db.select({ n: count() }).from(outbox).where(inArray(outbox.status, ['PENDING', 'SENDING', 'REVIEW'])).get()?.n ?? 0;
  }

  /** Cierra la sesión (los datos locales y la cola se conservan). La pantalla debe advertir antes si `pendingCount() > 0`. */
  async logout(): Promise<void> {
    await this.d.auth.logout();
    this.set({ status: 'anonymous', profile: null, permissions: [], error: null, busy: false });
  }
}
