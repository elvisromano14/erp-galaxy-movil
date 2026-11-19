import { createStore, type StoreApi } from 'zustand/vanilla';
import { ApiError } from '../../core/api/errors';
import { type ByteSink, type ChunkResponse, DownloadCancelled, DownloadIncomplete, downloadWithResume } from './download';
import { decideUpdate, formatMb, isSafeDownloadPath, type LatestInfo, POSTPONE_MS, type Postponed, shouldCheck, type UpdateKind, verifyDownload } from './updatePolicy';

/** Almacenamiento clave/valor persistente (en la app: `sync_meta`). */
export interface UpdateStorage { get(key: string): string | null; set(key: string, value: string): void; delete(key: string): void }

/** Archivos del espacio privado de la app. Las rutas son opacas para esta clase. */
export interface UpdateFiles {
  /** Archivo parcial de la versión (se va llenando). */
  partFor(version: string): ByteSink;
  finalPathFor(version: string): string;
  sizeOf(path: string): number | null;
  /** Mueve el parcial completo al nombre final y devuelve su ruta. */
  promote(version: string): string;
  remove(path: string): void;
  /** Borra todo lo descargado de versiones distintas a `keepVersion` (o todo si es null). */
  clean(keepVersion: string | null): void;
}

export interface UpdateHasher { sha256File(path: string, onProgress?: (fraction: number) => void): Promise<string> }
export interface UpdateInstaller {
  /** Abre el instalador del sistema con el APK. */
  install(path: string): Promise<void>;
  /** Abre los ajustes de «instalar apps desconocidas» de esta app. */
  openInstallSettings(): Promise<void>;
}
export interface UpdateApi {
  get<T>(path: string, o?: { query?: Record<string, string | number | boolean | undefined> }): Promise<T>;
  /** Respuesta cruda (con cuerpo en flujo) de una ruta autenticada, con `Range` opcional. */
  stream(path: string, o: { range?: { from: number } }): Promise<ChunkResponse>;
}

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  kind: UpdateKind;
  info: LatestInfo | null;
  /** Hay que mostrar la pantalla de actualización (versión nueva y no pospuesta). */
  promptNow: boolean;
  progress: { received: number; total: number } | null;
  /** 0…1 mientras se verifica la huella. */
  verifying: number | null;
  error: string | null;
  /** Sin sesión para consultar el servidor: la actualización se descarga a mano desde el ERP. */
  manualOnly: boolean;
  /** La descarga quedó a medias y se puede reanudar. */
  resumable: boolean;
  checkedAt: string | null;
}

const initial: UpdateState = { phase: 'idle', kind: 'none', info: null, promptNow: false, progress: null, verifying: null, error: null, manualOnly: false, resumable: false, checkedAt: null };

export interface UpdateDeps {
  api: UpdateApi; storage: UpdateStorage; files: UpdateFiles; hasher: UpdateHasher; installer: UpdateInstaller;
  currentVersion: string; appEnv: 'dev' | 'staging' | 'prod';
  /** Versión mínima que exige el servidor y que la app ya conoce (bloqueo UPGRADE_REQUIRED), si la hay. */
  knownMinVersion?: () => string | null;
  now?: () => number;
}

const K = { lastCheck: 'update:last_check', postponed: 'update:postponed' } as const;

/** Archivo descargado que no pasa la verificación (se descarta). */
class UpdateCorrupt extends Error { constructor(message: string) { super(message); this.name = 'UpdateCorrupt'; } }

/**
 * Actualización automática dentro de la app (sin tiendas): consulta la versión publicada en el ERP, la descarga (reanudable) en el
 * espacio privado, verifica tamaño y SHA-256 y abre el instalador del sistema. Android no permite instalar en silencio: la persona solo
 * pulsa «Instalar». Los pendientes sin sincronizar viven en SQLite y no se tocan. Toda la plataforma va detrás de interfaces (probable).
 */
export class UpdateService {
  readonly store: StoreApi<UpdateState> = createStore<UpdateState>(() => ({ ...initial }));
  private cancel = { cancelled: false };
  private running: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly d: UpdateDeps) { this.now = d.now ?? Date.now; }

  get state() { return this.store.getState(); }
  private set(p: Partial<UpdateState>) { this.store.setState(p); }

  private postponed(): Postponed | null {
    try {
      const j = JSON.parse(this.d.storage.get(K.postponed) ?? 'null') as Postponed | null;
      return j && typeof j.version === 'string' && typeof j.untilMs === 'number' ? j : null;
    } catch { return null; }
  }

  /** Consulta la versión publicada (como mucho cada 6 h salvo `force`). Nunca lanza: sin red se queda como estaba. */
  async check(o: { force?: boolean } = {}): Promise<UpdateState> {
    if (['downloading', 'verifying', 'installing'].includes(this.state.phase)) return this.state;
    if (!shouldCheck(this.d.storage.get(K.lastCheck), this.now(), o.force)) return this.state;
    const before = this.state.phase;
    this.set({ phase: 'checking', error: null });
    try {
      const info = await this.d.api.get<LatestInfo>('/mobile/app/latest', { query: { current: this.d.currentVersion } });
      const stamp = new Date(this.now()).toISOString();
      this.d.storage.set(K.lastCheck, stamp);
      const dec = decideUpdate({ current: this.d.currentVersion, appEnv: this.d.appEnv, info, knownMinVersion: this.d.knownMinVersion?.() ?? null, postponed: this.postponed(), nowMs: this.now() });
      if (dec.kind === 'none') {
        // Ya está al día (o no hay nada que ofrecer): se limpian descargas viejas.
        this.d.files.clean(null);
        this.d.storage.delete(K.postponed);
        this.set({ ...initial, checkedAt: stamp, info });
        return this.state;
      }
      if (!isSafeDownloadPath(info.downloadPath)) {
        this.set({ ...initial, phase: 'error', info, kind: dec.kind, checkedAt: stamp, error: 'La actualización publicada no es válida. Avise a administración.' });
        return this.state;
      }
      const version = info.version!;
      this.d.files.clean(version);
      const ready = this.d.files.sizeOf(this.d.files.finalPathFor(version)) === info.sizeBytes;
      const partial = this.d.files.partFor(version).size();
      this.set({ phase: ready ? 'ready' : 'available', kind: dec.kind, info, promptNow: dec.promptNow, progress: null, verifying: null, error: null, manualOnly: false, resumable: partial > 0 && !ready, checkedAt: stamp });
    } catch (e) {
      const restored = before === 'checking' ? (this.state.info ? 'available' : 'idle') : before;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) this.set({ phase: restored, manualOnly: true }); // sin sesión: descarga manual desde el ERP
      else this.set({ phase: restored }); // sin red: no pasa nada, se consulta otra vez más tarde
    }
    return this.state;
  }

  /** «Más tarde»: solo para versiones opcionales; no se vuelve a molestar con esa versión durante 24 h. */
  postpone() {
    const v = this.state.info?.version;
    if (!v || this.state.kind !== 'optional') return;
    this.d.storage.set(K.postponed, JSON.stringify({ version: v, untilMs: this.now() + POSTPONE_MS } satisfies Postponed));
    this.set({ promptNow: false });
  }

  /** La pantalla ya se mostró: no se vuelve a abrir sola hasta la próxima consulta. */
  markPrompted() { this.set({ promptNow: false }); }

  cancelDownload() { this.cancel.cancelled = true; }

  /** Descarga (o reanuda) y verifica. Termina cuando el archivo está listo para instalar o hubo un error (que queda en el estado). */
  download(): Promise<void> {
    this.running ??= this.doDownload().finally(() => { this.running = null; });
    return this.running;
  }

  private async doDownload(): Promise<void> {
    const info = this.state.info;
    if (!info?.version || !info.sha256 || !info.sizeBytes || !isSafeDownloadPath(info.downloadPath) || this.state.kind === 'none') return;
    const { version, sha256, sizeBytes, downloadPath } = info;
    this.cancel = { cancelled: false };
    const part = this.d.files.partFor(version);
    this.set({ phase: 'downloading', error: null, progress: { received: part.size(), total: sizeBytes }, resumable: false });
    try {
      const finalPath = this.d.files.finalPathFor(version);
      if (this.d.files.sizeOf(finalPath) !== sizeBytes) {
        await downloadWithResume({
          request: (range) => this.d.api.stream(downloadPath.replace(/^\/api\/v1/, ''), { range: range ?? undefined }), sink: part, expectedSize: sizeBytes, signal: this.cancel,
          onProgress: (received, total) => this.set({ progress: { received, total } }),
        });
        this.set({ phase: 'verifying', verifying: 0 });
        await this.verify(this.d.files.promote(version), sizeBytes, sha256);
      } else {
        this.set({ phase: 'verifying', verifying: 0 });
        await this.verify(finalPath, sizeBytes, sha256);
      }
      this.set({ phase: 'ready', progress: null, verifying: null, error: null });
    } catch (e) {
      const keep = part.size() > 0;
      if (e instanceof DownloadCancelled) this.set({ phase: 'available', progress: null, resumable: keep, error: null });
      else if (e instanceof DownloadIncomplete) this.set({ phase: 'error', progress: null, resumable: true, error: `La descarga se interrumpió (${formatMb(e.received)} de ${formatMb(e.expected)}). Vuelva a intentarlo: continúa donde quedó.` });
      else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) this.set({ phase: 'error', progress: null, manualOnly: true, error: 'Su sesión no permite descargar la actualización. Inicie sesión de nuevo o descárguela desde Configuración → App móvil del ERP.' });
      else if (e instanceof ApiError && e.isRetryable) this.set({ phase: 'error', progress: null, resumable: keep, error: 'Sin conexión con el servidor. Vuelva a intentarlo cuando tenga señal: la descarga continúa donde quedó.' });
      else if (e instanceof UpdateCorrupt) this.set({ phase: 'error', progress: null, verifying: null, resumable: false, error: e.message });
      else this.set({ phase: 'error', progress: null, resumable: keep, error: e instanceof Error ? e.message : 'No se pudo descargar la actualización.' });
    }
  }

  private async verify(path: string, expectedSize: number, expectedSha: string) {
    const size = this.d.files.sizeOf(path) ?? -1;
    const sha = size === expectedSize ? await this.d.hasher.sha256File(path, (f) => this.set({ verifying: f })) : '';
    const r = verifyDownload({ size, expectedSize, sha256: sha, expectedSha256: expectedSha });
    if (!r.ok) {
      this.d.files.remove(path);
      throw new UpdateCorrupt(r.reason === 'SIZE' ? 'El archivo descargado está incompleto y se descartó. Vuelva a descargar.' : 'El archivo descargado no coincide con el publicado (huella SHA-256 distinta) y se descartó. Vuelva a descargar.');
    }
  }

  /** Abre el instalador del sistema. Si Android no permite instalar desde esta app, el sistema ofrece los ajustes. */
  async install(): Promise<void> {
    const info = this.state.info;
    if (this.state.phase !== 'ready' || !info?.version) return;
    this.set({ phase: 'installing', error: null });
    try {
      await this.d.installer.install(this.d.files.finalPathFor(info.version));
      this.set({ phase: 'ready' });
    } catch (e) {
      this.set({ phase: 'ready', error: e instanceof Error ? `No se pudo abrir el instalador: ${e.message}` : 'No se pudo abrir el instalador.' });
    }
  }

  openInstallSettings() { return this.d.installer.openInstallSettings(); }
}
