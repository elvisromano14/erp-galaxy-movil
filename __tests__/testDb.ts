import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '../src/db/schema';
import type { AppDb } from '../src/db/types';

/** SQLite real en memoria con las MISMAS migraciones que corren en el teléfono. */
export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) sqlite.exec(stmt);
  }
  return { db: drizzle(sqlite, { schema }) as unknown as AppDb, sqlite };
}
