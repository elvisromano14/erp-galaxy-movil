import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { ApiClient } from './api/ApiClient';
import { AuthService } from './auth/AuthService';
import { secureDeviceStore, secureTokenStore } from './auth/secureStorage';
import { readEnv } from './config/env';

const env = readEnv();

/** Servicios únicos de la app (la UI los usa a través de hooks/servicios, no llama a la API directamente). */
export const api = new ApiClient({
  baseUrl: env.apiUrl,
  appVersion: env.appVersion,
  tokens: secureTokenStore,
  getDeviceId: () => auth.deviceId,
});

export const auth: AuthService = new AuthService(api, secureTokenStore, secureDeviceStore, {
  deviceName: `${Platform.OS === 'android' ? 'Android' : 'iOS'} ${Platform.Version}`,
  newDeviceKey: () => Crypto.randomUUID(),
  appVersion: env.appVersion,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
});

export { env };
