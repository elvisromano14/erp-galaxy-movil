import { eq } from 'drizzle-orm';
import type { AppDb } from './types';
import { syncMeta } from './schema';

/** Claves de `sync_meta` (pares clave/valor de la sincronización y la sesión local). */
export const META = {
  bootstrapDoneAt: 'bootstrap_done_at',
  companyId: 'company_id',
  deviceCode: 'device_code',
  permissions: 'permissions',
  lastSyncAt: 'last_sync_at',
  localSeq: 'local_seq',
  revokedAt: 'revoked_at',
  cursor: (entity: string) => `cursor:${entity}`,
} as const;

export function getMeta(db: AppDb, key: string): string | null {
  return db.select().from(syncMeta).where(eq(syncMeta.key, key)).get()?.value ?? null;
}

export function setMeta(db: AppDb, key: string, value: string): void {
  db.insert(syncMeta).values({ key, value }).onConflictDoUpdate({ target: syncMeta.key, set: { value } }).run();
}

export function deleteMeta(db: AppDb, key: string): void {
  db.delete(syncMeta).where(eq(syncMeta.key, key)).run();
}

export function getJson<T>(db: AppDb, key: string): T | null {
  const raw = getMeta(db, key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export const setJson = (db: AppDb, key: string, value: unknown) => setMeta(db, key, JSON.stringify(value));
