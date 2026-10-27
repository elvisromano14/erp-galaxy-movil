import { versionLt } from '../../core/version';

/** Respuesta de `GET /mobile/app/latest` (ver docs/API-MOVIL-ACTUALIZACION.md del ERP). */
export interface LatestInfo {
  available: boolean;
  version: string | null; versionCode: number | null;
  updateAvailable: boolean;
  /** El servidor exige actualizar: la versión instalada está por debajo de `minAppVersion`. */
  mandatory: boolean;
  minAppVersion: string;
  notes: string | null; sizeBytes: number | null; sha256: string | null; fileName: string | null; uploadedAt?: string | null;
  downloadPath: string | null;
}

/** Cada cuánto se consulta si hay versión nueva (al arrancar y al volver a primer plano). */
export const CHECK_INTERVAL_MS = 6 * 3_600_000;
/** Tiempo que se deja de molestar con la MISMA versión opcional tras «Más tarde». */
export const POSTPONE_MS = 24 * 3_600_000;

export const shouldCheck = (lastCheckIso: string | null, nowMs: number, force = false): boolean => {
  if (force || !lastCheckIso) return true;
  const last = new Date(lastCheckIso).getTime();
  // Reloj atrasado (última consulta «en el futuro»): se consulta.
  return !Number.isFinite(last) || last > nowMs || nowMs - last >= CHECK_INTERVAL_MS;
};

export type UpdateKind = 'none' | 'optional' | 'mandatory';
export interface Postponed { version: string; untilMs: number }

/**
 * Variante del APK publicado (`erp-ventas-<dev|staging|prod>-x.y.z.apk`). Android solo ACTUALIZA si el applicationId coincide; un APK de
 * otra variante se instalaría al lado como app distinta, así que solo se ofrece el de la misma variante (un nombre sin variante = prod).
 */
export function variantOf(fileName: string | null): 'dev' | 'staging' | 'prod' | null {
  if (!fileName) return null;
  const m = /^erp-ventas-(dev|staging|prod)-/i.exec(fileName);
  return m ? (m[1].toLowerCase() as 'dev' | 'staging' | 'prod') : 'prod';
}

export interface DecideInput {
  current: string; appEnv: 'dev' | 'staging' | 'prod';
  info: LatestInfo | null;
  /** Mínima que ya conoce la app por `GET /app/config` (bloqueo por versión obsoleta). */
  knownMinVersion?: string | null;
  postponed: Postponed | null; nowMs: number;
}
export interface UpdateDecision { kind: UpdateKind; /** Mostrar la pantalla de actualización ahora. */ promptNow: boolean; reason?: string }

/** Decide qué hacer con la versión publicada. Pura: no toca red ni disco. */
export function decideUpdate(i: DecideInput): UpdateDecision {
  const info = i.info;
  if (!info || !info.available || !info.version || !info.sha256 || !info.sizeBytes || !info.downloadPath) return { kind: 'none', promptNow: false, reason: 'No hay una versión publicada para descargar' };
  if (variantOf(info.fileName) !== i.appEnv) return { kind: 'none', promptNow: false, reason: 'La versión publicada es de otra variante de la app' };
  if (!versionLt(i.current, info.version)) return { kind: 'none', promptNow: false, reason: 'Ya tiene la versión más reciente' };
  const mandatory = info.mandatory || versionLt(i.current, info.minAppVersion) || (!!i.knownMinVersion && versionLt(i.current, i.knownMinVersion));
  if (mandatory) return { kind: 'mandatory', promptNow: true };
  const snoozed = i.postponed && i.postponed.version === info.version && i.nowMs < i.postponed.untilMs;
  return { kind: 'optional', promptNow: !snoozed };
}

/** La ruta de descarga debe ser de la propia API del ERP (nunca una URL externa ni con `..`). */
export const isSafeDownloadPath = (p: string | null): p is string => !!p && /^\/api\/v1\/mobile\/app\/[A-Za-z0-9/_-]+$/.test(p) && !p.includes('..');

export type VerifyResult = { ok: true } | { ok: false; reason: 'SIZE' | 'HASH' };
/** Tamaño y huella SHA-256 del archivo descargado frente a lo que publicó el servidor. */
export function verifyDownload(o: { size: number; expectedSize: number; sha256: string; expectedSha256: string }): VerifyResult {
  if (o.size !== o.expectedSize) return { ok: false, reason: 'SIZE' };
  if (o.sha256.toLowerCase() !== o.expectedSha256.toLowerCase()) return { ok: false, reason: 'HASH' };
  return { ok: true };
}

export const formatMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes >= 10 * 1_048_576 ? 0 : 1)} MB`;
