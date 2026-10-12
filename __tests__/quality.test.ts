import { sql } from 'drizzle-orm';
import { colors } from '../src/ui/kit';
import { ApiClient } from '../src/core/api/ApiClient';
import { seedCatalog } from './catalog';
import { fakeFetch, memoryTokens } from './helpers';

/** Luminancia relativa y razón de contraste WCAG 2.1. */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('accesibilidad (WCAG AA: texto normal ≥ 4,5:1)', () => {
  it('la paleta cumple el contraste sobre fondo blanco y en las alertas', () => {
    for (const k of ['text', 'muted', 'primary', 'error', 'ok'] as const) expect(contrast(colors[k], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.warn, colors.warnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', colors.primary)).toBeGreaterThanOrEqual(4.5); // texto blanco de los botones
    expect(contrast('#ffffff', colors.error)).toBeGreaterThanOrEqual(4.5);   // botón de peligro
  });
});

describe('rendimiento: las consultas calientes usan índices', () => {
  const plan = async (q: ReturnType<typeof sql>) => {
    const db = await seedCatalog();
    return db.all<Record<string, string>>(q).map((r) => r.detail).join(' | ');
  };
  it('código de barras, existencias y precios por producto, cola por estado y líneas por documento', async () => {
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT p.id FROM product_refs r JOIN products p ON p.id = r.product_id WHERE r.kind = 'BARCODE' AND r.code = 'X'`)).toMatch(/idx_product_refs_code|SEARCH r/);
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT * FROM stock_snapshots WHERE product_id = 'p1'`)).toContain('idx_stock_product');
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT price FROM product_prices WHERE product_id = 'p1' AND price_list_id = 'L1' AND valid_from <= '2026-10-11' ORDER BY valid_from DESC LIMIT 1`)).toContain('idx_product_prices_product');
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY client_seq LIMIT 20`)).toContain('idx_outbox_status_seq');
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT * FROM sales_document_lines WHERE document_id = 'd1'`)).toContain('idx_lines_doc');
    expect(await plan(sql`EXPLAIN QUERY PLAN SELECT * FROM sales_documents WHERE doc_type = 'QUOTE' AND local_status = 'DRAFT'`)).toContain('idx_docs_type_status');
  });
});

describe('monitoreo desde la oficina', () => {
  it('reporta el tamaño de la cola solo con dispositivo registrado', async () => {
    const f = fakeFetch({ 'GET /sync/pull': { body: { data: {} } } });
    let size: number | null = 3; let device: string | null = 'dev-1';
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens(), fetchImpl: f.impl, getDeviceId: () => device, getQueueSize: () => size });
    await api.get('/sync/pull'); expect(f.calls[0].headers['x-queue-size']).toBe('3');
    size = 0; await api.get('/sync/pull'); expect(f.calls[1].headers['x-queue-size']).toBe('0');
    size = null; await api.get('/sync/pull'); expect(f.calls[2].headers['x-queue-size']).toBeUndefined();
    device = null; size = 5; await api.get('/sync/pull'); expect(f.calls[3].headers['x-queue-size']).toBeUndefined();
  });
});
