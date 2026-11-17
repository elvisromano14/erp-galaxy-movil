import { sql } from 'drizzle-orm';
import type { AppDb } from '../../db/types';

/** Marca de cada producto (para mostrarla en las líneas de los documentos, el PDF y el recibo). Solo devuelve los que tienen marca. */
export function brandsOf(db: AppDb, productIds: string[]): Map<string, string> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const rows = db.all<{ id: string; brand: string | null }>(sql`SELECT id, brand FROM products WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return new Map(rows.filter((r) => r.brand && r.brand.trim()).map((r) => [r.id, r.brand!.trim()]));
}
