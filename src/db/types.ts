import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * Base de datos de la app. Tanto el driver de expo-sqlite (dispositivo) como el de better-sqlite3 (pruebas en Node) son
 * síncronos, así que los repositorios se escriben contra este tipo común y se prueban con SQLite real.
 */
export type AppDb = BaseSQLiteDatabase<'sync', any, typeof schema>;
