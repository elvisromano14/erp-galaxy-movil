import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

/** Base local (réplica + documentos + cola de salida). WAL y llaves foráneas activas; las migraciones las aplica `useMigrations` al arrancar. */
const sqlite = openDatabaseSync('erp.db', { enableChangeListener: true });
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
