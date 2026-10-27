import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { fetch as streamFetch } from 'expo/fetch';
import { getMeta, deleteMeta, setMeta } from '../../db/meta';
import type { AppDb } from '../../db/types';
import type { UpdateFiles, UpdateHasher, UpdateInstaller, UpdateStorage } from './UpdateService';
import { Sha256 } from './sha256';

/** Implementaciones de plataforma (Expo SDK 57) detrás de las interfaces de `UpdateService`. No se cargan en las pruebas de Node. */

/** `fetch` con respuesta en flujo (el de React Native lee todo el cuerpo en memoria). */
export const updateStreamFetch = streamFetch as unknown as typeof fetch;

/** Claves de actualización en `sync_meta` (persisten entre arranques; se conservan al cerrar sesión). */
export const metaUpdateStorage = (db: AppDb): UpdateStorage => ({
  get: (k) => getMeta(db, k), set: (k, v) => setMeta(db, k, v), delete: (k) => deleteMeta(db, k),
});

const PREFIX = 'erp-ventas-update-';
const dir = () => new Directory(Paths.cache, 'updates');
const ensureDir = () => { const d = dir(); if (!d.exists) d.create({ intermediates: true, idempotent: true }); return d; };
const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, '_');

/** Espacio privado de la app (caché): solo esta app lo lee; se comparte con el instalador mediante un FileProvider (`contentUri`). */
export const expoUpdateFiles: UpdateFiles = {
  partFor(version) {
    const file = new File(ensureDir(), `${PREFIX}${safe(version)}.part`);
    let handle: ReturnType<File['open']> | null = null;
    const close = () => { try { handle?.close(); } catch { /* ya cerrado */ } handle = null; };
    return {
      size: () => (file.exists ? file.size : 0),
      truncate: () => { close(); if (file.exists) file.delete(); },
      append: (chunk) => {
        if (!file.exists) file.create({ intermediates: true });
        if (!handle) handle = file.open(FileMode.Append);
        handle.writeBytes(chunk);
      },
      close,
    };
  },
  finalPathFor: (version) => new File(ensureDir(), `${PREFIX}${safe(version)}.apk`).uri,
  sizeOf(path) { const f = new File(path); return f.exists ? f.size : null; },
  promote(version) {
    const part = new File(ensureDir(), `${PREFIX}${safe(version)}.part`);
    const dest = new File(ensureDir(), `${PREFIX}${safe(version)}.apk`);
    if (dest.exists) dest.delete();
    part.moveSync(dest);
    return dest.uri;
  },
  remove(path) { const f = new File(path); if (f.exists) f.delete(); },
  clean(keepVersion) {
    const d = dir();
    if (!d.exists) return;
    const keep = keepVersion ? `${PREFIX}${safe(keepVersion)}.` : null;
    for (const item of d.list()) if (item instanceof File && item.name.startsWith(PREFIX) && !(keep && item.name.startsWith(keep))) item.delete();
  },
};

const MAX_NATIVE_BYTES = 48 * 1_048_576;
const CHUNK = 1_048_576;
const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256: nativo y rápido para archivos de hasta 48 MB; por trozos (JS) para los más grandes, sin cargarlos enteros en memoria. */
export const expoFileHasher: UpdateHasher = {
  async sha256File(path, onProgress) {
    const file = new File(path);
    if (file.size <= MAX_NATIVE_BYTES) {
      const hex = toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes()));
      onProgress?.(1);
      return hex;
    }
    const h = new Sha256();
    const handle = file.open(FileMode.ReadOnly);
    try {
      const total = file.size;
      for (let read = 0; read < total; read += CHUNK) {
        h.update(handle.readBytes(Math.min(CHUNK, total - read)));
        onProgress?.(Math.min(1, (read + CHUNK) / total));
        await new Promise<void>((r) => setTimeout(r, 0)); // cede el hilo para que la barra se mueva
      }
    } finally { handle.close(); }
    return h.digestHex();
  },
};

const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/**
 * Instalador del sistema (Android): `ACTION_VIEW` con el APK como `content://` (FileProvider de `expo-file-system`). Si la app aún no
 * tiene permitido «instalar apps desconocidas», Android muestra su aviso con un acceso directo a ese ajuste.
 */
export const expoInstaller: UpdateInstaller = {
  async install(path) {
    const uri = new File(path).contentUri;
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: uri, type: 'application/vnd.android.package-archive', flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    });
  },
  async openInstallSettings() {
    const pkg = Constants.expoConfig?.android?.package;
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, pkg ? { data: `package:${pkg}` } : {});
  },
};
