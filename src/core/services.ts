import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { db } from '../db/client';
import { counts } from '../db/repositories/outbox';
import { ApiClient } from './api/ApiClient';
import { AuthService } from './auth/AuthService';
import { expoBiometric, expoHasher, securePinStorage } from './auth/native';
import { PinLock } from './auth/PinLock';
import { secureDeviceStore, secureTokenStore } from './auth/secureStorage';
import { readEnv } from './config/env';
import { SessionService } from './session/SessionService';
import { defaultHandlers } from '../sync/handlers';
import { SyncEngine } from '../sync/SyncEngine';
import { versionLt } from './version';
import { expoFileHasher, expoInstaller, expoUpdateFiles, metaUpdateStorage, updateStreamFetch } from '../features/update/native';
import { UpdateService } from '../features/update/UpdateService';

const env = readEnv();

/** Servicios únicos de la app. La UI no llama a la API directamente: usa `session` (estado y acciones) y, más adelante, los servicios de cada módulo. */
export const api: ApiClient = new ApiClient({
  baseUrl: env.apiUrl,
  appVersion: env.appVersion,
  tokens: secureTokenStore,
  getDeviceId: () => auth.deviceId,
  getQueueSize: () => { try { const c = counts(db); return c.PENDING + c.SENDING; } catch { return null; } },
  onSessionExpired: () => session.onSessionExpired(),
  streamFetchImpl: updateStreamFetch,
});

export const auth: AuthService = new AuthService(api, secureTokenStore, secureDeviceStore, {
  deviceName: `${Platform.OS === 'android' ? 'Android' : 'iOS'} ${Platform.Version}`,
  newDeviceKey: () => Crypto.randomUUID(),
  appVersion: env.appVersion,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
});

export const pin = new PinLock(securePinStorage, expoHasher);

export const engine = new SyncEngine({ api, db, handlers: defaultHandlers });

export const session: SessionService = new SessionService({
  api, auth, tokens: secureTokenStore, db, pin, biometric: expoBiometric, engine, appVersion: env.appVersion, versionLt,
});

/** Actualización automática de la app (descarga reanudable del APK publicado en el ERP + instalador del sistema). */
export const updater = new UpdateService({
  api: { get: (path, o) => api.get(path, o), stream: (path, o) => api.stream(path, o) as never },
  storage: metaUpdateStorage(db), files: expoUpdateFiles, hasher: expoFileHasher, installer: expoInstaller,
  currentVersion: env.appVersion, appEnv: env.appEnv, knownMinVersion: () => session.state.minAppVersion,
});

export { env, db };
