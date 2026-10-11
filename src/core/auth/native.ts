import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import type { Hasher, PinRecord, PinStorage } from './PinLock';

const PIN_KEY = 'erp.pin';
const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const securePinStorage: PinStorage = {
  async get() {
    const raw = await SecureStore.getItemAsync(PIN_KEY, opts);
    try { return raw ? (JSON.parse(raw) as PinRecord) : null; } catch { return null; }
  },
  set: (r) => SecureStore.setItemAsync(PIN_KEY, JSON.stringify(r), opts),
  clear: () => SecureStore.deleteItemAsync(PIN_KEY, opts),
};

export const expoHasher: Hasher = {
  randomHex: (bytes) => Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join(''),
  sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
};

/** Huella / reconocimiento facial del teléfono (opcional; el PIN siempre está disponible). */
export interface Biometric { isAvailable(): Promise<boolean>; authenticate(prompt: string): Promise<boolean> }

export const expoBiometric: Biometric = {
  async isAvailable() {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  },
  async authenticate(prompt) {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Usar PIN', disableDeviceFallback: true });
    return r.success;
  },
};
