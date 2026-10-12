/**
 * Clave de cifrado de la base local (SQLCipher, opcional: se activa al compilar con `SQLCIPHER=1`). La clave es aleatoria, se genera
 * al primer arranque y vive SOLO en el Keystore (SecureStore); nunca sale del teléfono ni se guarda junto a la base.
 */
export interface KeyStore { get(): string | null; set(value: string): void }

export function getOrCreateDbKey(store: KeyStore, randomHex: (bytes: number) => string): string {
  const existing = store.get();
  if (existing) return existing;
  const key = randomHex(32);
  store.set(key);
  return key;
}

/** Sentencia que desbloquea la base (la clave va entre comillas simples; es hexadecimal, sin caracteres especiales). */
export const pragmaKey = (key: string) => `PRAGMA key = '${key.replace(/[^0-9a-fA-F]/g, '')}';`;
