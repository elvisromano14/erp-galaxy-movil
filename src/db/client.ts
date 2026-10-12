import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';
import { readEnv } from '../core/config/env';
import { getOrCreateDbKey, pragmaKey } from './encryption';
import * as schema from './schema';

/** Base local (réplica + documentos + cola de salida). WAL y llaves foráneas activas; las migraciones las aplica `useMigrations` al arrancar. */
const sqlite = openDatabaseSync('erp.db', { enableChangeListener: true });
// Cifrado (SQLCipher) si la app se compiló con SQLCIPHER=1: la primera sentencia debe ser la clave.
if (readEnv().sqlcipher) {
  const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const key = getOrCreateDbKey(
    { get: () => SecureStore.getItem('erp.dbKey', opts), set: (v) => SecureStore.setItem('erp.dbKey', v, opts) },
    (n) => Array.from(Crypto.getRandomBytes(n), (b) => b.toString(16).padStart(2, '0')).join(''),
  );
  sqlite.execSync(pragmaKey(key));
}
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
