import * as SecureStore from 'expo-secure-store';
import type { TokenPair, TokenStore } from '../api/ApiClient';
import type { DeviceStore } from './AuthService';

const REFRESH = 'erp.refreshToken';
const DEVICE_KEY = 'erp.deviceKey';
const DEVICE_ID = 'erp.deviceId';
const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Tokens y dispositivo en el Keystore de Android (expo-secure-store). El access token vive solo en memoria. */
export const secureTokenStore: TokenStore = {
  getRefresh: () => SecureStore.getItemAsync(REFRESH, opts),
  save: (pair: TokenPair) => SecureStore.setItemAsync(REFRESH, pair.refreshToken, opts),
  clear: () => SecureStore.deleteItemAsync(REFRESH, opts),
};

export const secureDeviceStore: DeviceStore = {
  getKey: () => SecureStore.getItemAsync(DEVICE_KEY, opts),
  saveKey: (k) => SecureStore.setItemAsync(DEVICE_KEY, k, opts),
  getDeviceId: () => SecureStore.getItemAsync(DEVICE_ID, opts),
  saveDeviceId: (id) => SecureStore.setItemAsync(DEVICE_ID, id, opts),
  clear: async () => { await SecureStore.deleteItemAsync(DEVICE_ID, opts); },
};
