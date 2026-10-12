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

const env = readEnv();

/** Servicios únicos de la app. La UI no llama a la API directamente: usa `session` (estado y acciones) y, más adelante, los servicios de cada módulo. */
export const api: ApiClient = new ApiClient({
  baseUrl: env.apiUrl,
  appVersion: env.appVersion,
  tokens: secureTokenStore,
  getDeviceId: () => auth.deviceId,
  getQueueSize: () => { try { const c = counts(db); return c.PENDING + c.SENDING; } catch { return null; } },
  onSessionExpired: () => session.onSessionExpired(),
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

export { env, db };
