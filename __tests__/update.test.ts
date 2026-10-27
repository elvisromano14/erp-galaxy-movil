import { createHash, randomBytes } from 'node:crypto';
import { ApiClient } from '../src/core/api/ApiClient';
import { ApiError } from '../src/core/api/errors';
import { type ByteSink, type ChunkResponse, downloadWithResume, DownloadCancelled, DownloadIncomplete } from '../src/features/update/download';
import { Sha256, sha256Hex } from '../src/features/update/sha256';
import { type UpdateApi, type UpdateDeps, type UpdateFiles, UpdateService } from '../src/features/update/UpdateService';
import { CHECK_INTERVAL_MS, decideUpdate, isSafeDownloadPath, type LatestInfo, POSTPONE_MS, shouldCheck, variantOf, verifyDownload } from '../src/features/update/updatePolicy';
import { fakeFetch, memoryTokens } from './helpers';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const apk = randomBytes(10_000);
const info = (o: Partial<LatestInfo> = {}): LatestInfo => ({
  available: true, version: '0.3.0', versionCode: 30, updateAvailable: true, mandatory: false, minAppVersion: '0.1.0', notes: 'Crea productos', sizeBytes: apk.length, sha256: sha(apk),
  fileName: 'erp-ventas-prod-0.3.0.apk', downloadPath: '/api/v1/mobile/app/latest/file', ...o,
});

describe('SHA-256 incremental', () => {
  it('coincide con node:crypto en vectores conocidos, límites de bloque y trozos irregulares', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65_537]) { const b = randomBytes(n); expect(sha256Hex(b)).toBe(sha(b)); }
    const big = randomBytes(300_000); const h = new Sha256();
    for (let i = 0, step = 1; i < big.length; i += step, step = (step * 7) % 9973 + 1) h.update(big.subarray(i, i + step));
    expect(h.digestHex()).toBe(sha(big));
  });
});

describe('política de actualización', () => {
  const base = { current: '0.2.0', appEnv: 'prod' as const, info: info(), postponed: null, nowMs: 1_000_000 };
  it('versión nueva opcional → ofrece; ya al día, sin APK o de otra variante → nada', () => {
    expect(decideUpdate(base)).toEqual({ kind: 'optional', promptNow: true });
    expect(decideUpdate({ ...base, current: '0.3.0' }).kind).toBe('none');
    expect(decideUpdate({ ...base, current: '1.0.0' }).kind).toBe('none');
    expect(decideUpdate({ ...base, info: info({ available: false, version: null }) }).kind).toBe('none');
    expect(decideUpdate({ ...base, info: null }).kind).toBe('none');
    expect(decideUpdate({ ...base, info: info({ sha256: null }) }).kind).toBe('none'); // sin huella no se instala nada
    expect(decideUpdate({ ...base, info: info({ fileName: 'erp-ventas-staging-0.3.0.apk' }) }).kind).toBe('none'); // otra variante = otra app
    expect(decideUpdate({ ...base, appEnv: 'dev', info: info({ fileName: 'erp-ventas-dev-0.3.0.apk' }) }).kind).toBe('optional');
  });
  it('obligatoria si lo dice el servidor, si está por debajo de la mínima o de la mínima ya conocida', () => {
    expect(decideUpdate({ ...base, info: info({ mandatory: true }) })).toEqual({ kind: 'mandatory', promptNow: true });
    expect(decideUpdate({ ...base, current: '0.0.9', info: info({ minAppVersion: '0.1.0' }) }).kind).toBe('mandatory');
    expect(decideUpdate({ ...base, knownMinVersion: '0.2.5' }).kind).toBe('mandatory');
  });
  it('«Más tarde» silencia la MISMA versión 24 h; una versión más nueva vuelve a avisar; la obligatoria nunca se silencia', () => {
    const postponed = { version: '0.3.0', untilMs: 1_000_000 + POSTPONE_MS };
    expect(decideUpdate({ ...base, postponed })).toEqual({ kind: 'optional', promptNow: false });
    expect(decideUpdate({ ...base, postponed, nowMs: postponed.untilMs + 1 }).promptNow).toBe(true);
    expect(decideUpdate({ ...base, postponed, info: info({ version: '0.3.1' }) }).promptNow).toBe(true);
    expect(decideUpdate({ ...base, postponed, info: info({ mandatory: true }) }).promptNow).toBe(true);
  });
  it('consulta cada 6 h; forzar y reloj atrasado consultan', () => {
    const t0 = new Date(0).toISOString();
    expect(shouldCheck(null, 5)).toBe(true); expect(shouldCheck(t0, CHECK_INTERVAL_MS - 1)).toBe(false); expect(shouldCheck(t0, CHECK_INTERVAL_MS)).toBe(true);
    expect(shouldCheck(t0, 10, true)).toBe(true); expect(shouldCheck(new Date(5_000_000).toISOString(), 1_000)).toBe(true); expect(shouldCheck('basura', 1_000)).toBe(true);
  });
  it('variante, ruta de descarga segura y verificación de tamaño/huella', () => {
    expect(variantOf('erp-ventas-prod-1.0.0.apk')).toBe('prod'); expect(variantOf('erp-ventas-dev-1.0.0.apk')).toBe('dev'); expect(variantOf('app.apk')).toBe('prod'); expect(variantOf(null)).toBeNull();
    expect(isSafeDownloadPath('/api/v1/mobile/app/latest/file')).toBe(true);
    for (const bad of [null, 'https://evil.example/a.apk', '//evil.example/a.apk', '/api/v1/mobile/app/../../auth/login', '/api/v1/other', 'file:///x']) expect(isSafeDownloadPath(bad as never)).toBe(false);
    expect(verifyDownload({ size: 5, expectedSize: 5, sha256: 'AB', expectedSha256: 'ab' })).toEqual({ ok: true });
    expect(verifyDownload({ size: 4, expectedSize: 5, sha256: 'ab', expectedSha256: 'ab' })).toEqual({ ok: false, reason: 'SIZE' });
    expect(verifyDownload({ size: 5, expectedSize: 5, sha256: 'ab', expectedSha256: 'cd' })).toEqual({ ok: false, reason: 'HASH' });
  });
});

// ───────────── descarga reanudable ─────────────
class MemSink implements ByteSink {
  data = Buffer.alloc(0); closed = 0;
  constructor(initial?: Uint8Array) { if (initial) this.data = Buffer.from(initial); }
  size() { return this.data.length; }
  truncate() { this.data = Buffer.alloc(0); }
  append(c: Uint8Array) { this.data = Buffer.concat([this.data, c]); }
  close() { this.closed++; }
}
const streamOf = (bytes: Uint8Array, chunk = 1000, failAfter = Infinity): ChunkResponse['body'] => {
  let i = 0;
  return { getReader: () => ({ async read() { if (i >= failAfter) throw new Error('red caída'); if (i >= bytes.length) return { done: true }; const v = bytes.subarray(i, Math.min(i + chunk, bytes.length)); i += v.length; return { done: false, value: v }; }, async cancel() { return undefined; } }) };
};
/** Servidor de APK simulado: honra `Range` salvo que se le pida ignorarlo. */
const server = (o: { ignoreRange?: boolean; failAfter?: number; reject416?: boolean; badRange?: boolean } = {}) => {
  const calls: Array<{ from: number } | null> = [];
  return {
    calls,
    request: async (range: { from: number } | null): Promise<ChunkResponse> => {
      calls.push(range);
      if (range && o.reject416) return { status: 416, headers: { get: () => null }, body: null };
      if (range && !o.ignoreRange) return { status: 206, headers: { get: (n) => (n === 'content-range' ? `bytes ${o.badRange ? range.from + 1 : range.from}-${apk.length - 1}/${apk.length}` : null) }, body: streamOf(apk.subarray(range.from), 1000, o.failAfter) };
      return { status: 200, headers: { get: () => null }, body: streamOf(apk, 1000, o.failAfter) };
    },
  };
};

describe('downloadWithResume', () => {
  it('descarga completa con progreso y cierra el archivo', async () => {
    const sink = new MemSink(); const prog: number[] = []; const s = server();
    await downloadWithResume({ request: s.request, sink, expectedSize: apk.length, onProgress: (r) => prog.push(r) });
    expect(Buffer.compare(sink.data, apk)).toBe(0); expect(sink.closed).toBe(1); expect(prog.at(-1)).toBe(apk.length); expect(s.calls).toEqual([null]);
  });
  it('un corte deja el parcial y la siguiente vez pide solo lo que falta (Range)', async () => {
    const sink = new MemSink();
    await expect(downloadWithResume({ request: server({ failAfter: 4000 }).request, sink, expectedSize: apk.length })).rejects.toBeInstanceOf(DownloadIncomplete);
    expect(sink.size()).toBe(4000); expect(sink.closed).toBe(1);
    const s = server();
    const r = await downloadWithResume({ request: s.request, sink, expectedSize: apk.length });
    expect(r.resumedFrom).toBe(4000); expect(s.calls).toEqual([{ from: 4000 }]); expect(Buffer.compare(sink.data, apk)).toBe(0);
  });
  it('si el servidor ignora el rango (200) o responde 416 se reinicia de cero; si el parcial es mayor de lo esperado también', async () => {
    const a = new MemSink(apk.subarray(0, 3000));
    await downloadWithResume({ request: server({ ignoreRange: true }).request, sink: a, expectedSize: apk.length });
    expect(Buffer.compare(a.data, apk)).toBe(0);
    const b = new MemSink(apk.subarray(0, 3000)); const s416 = server({ reject416: true });
    await downloadWithResume({ request: s416.request, sink: b, expectedSize: apk.length });
    expect(Buffer.compare(b.data, apk)).toBe(0); expect(s416.calls).toEqual([{ from: 3000 }, null]);
    const c = new MemSink(Buffer.concat([apk, Buffer.from('basura')]));
    await downloadWithResume({ request: server().request, sink: c, expectedSize: apk.length });
    expect(Buffer.compare(c.data, apk)).toBe(0);
  });
  it('un Content-Range desalineado descarta el parcial en vez de pegar trozos que no corresponden', async () => {
    const sink = new MemSink(apk.subarray(0, 2000));
    await expect(downloadWithResume({ request: server({ badRange: true }).request, sink, expectedSize: apk.length })).rejects.toThrow(/no corresponde/);
    expect(sink.size()).toBe(0);
  });
  it('cancelar detiene la descarga conservando lo recibido', async () => {
    const sink = new MemSink(); const signal = { cancelled: false };
    await expect(downloadWithResume({ request: server().request, sink, expectedSize: apk.length, signal, onProgress: (r) => { if (r >= 3000) signal.cancelled = true; } })).rejects.toBeInstanceOf(DownloadCancelled);
    expect(sink.size()).toBeGreaterThan(0); expect(sink.size()).toBeLessThan(apk.length); expect(sink.closed).toBe(1);
  });
});

// ───────────── servicio completo con plataforma simulada ─────────────
function fakePlatform(over: { latest?: () => Promise<LatestInfo>; stream?: ReturnType<typeof server>['request']; installFails?: boolean; initialPart?: Uint8Array } = {}) {
  const files = new Map<string, Buffer>(); const parts = new Map<string, MemSink>(); const store = new Map<string, string>(); const installs: string[] = [];
  if (over.initialPart) parts.set('0.3.0', new MemSink(over.initialPart));
  let cleaned: Array<string | null> = []; let hashed = 0; const requested: string[] = [];
  const fs: UpdateFiles = {
    partFor: (v) => { if (!parts.has(v)) parts.set(v, new MemSink()); return parts.get(v)!; },
    finalPathFor: (v) => `/cache/update-${v}.apk`,
    sizeOf: (p) => files.get(p)?.length ?? null,
    promote: (v) => { const p = `/cache/update-${v}.apk`; files.set(p, parts.get(v)!.data); parts.delete(v); return p; },
    remove: (p) => { files.delete(p); },
    clean: (keep) => { cleaned.push(keep); for (const k of [...parts.keys()]) if (k !== keep) parts.delete(k); for (const p of [...files.keys()]) if (!keep || !p.includes(`-${keep}.`)) files.delete(p); },
  };
  const api: UpdateApi = {
    get: async <T,>(path: string) => { requested.push(path); return (await (over.latest ?? (async () => info()))()) as T; },
    stream: async (path, o) => { requested.push(`${path}${o.range ? `#from=${o.range.from}` : ''}`); return (over.stream ?? server().request)(o.range ?? null); },
  };
  let now = 1_000_000_000;
  const d: UpdateDeps = {
    api, files: fs, currentVersion: '0.2.0', appEnv: 'prod', now: () => now,
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) },
    hasher: { sha256File: async (p, cb) => { hashed++; cb?.(0.5); return sha(files.get(p) ?? Buffer.alloc(0)); } },
    installer: { install: async (p) => { if (over.installFails) throw new Error('sin instalador'); installs.push(p); }, openInstallSettings: async () => undefined },
  };
  return { svc: new UpdateService(d), files, parts, store, installs, requested, advance: (ms: number) => { now += ms; }, get cleaned() { return cleaned; }, get hashed() { return hashed; } };
}

describe('UpdateService', () => {
  it('consulta con la versión instalada, ofrece la nueva y la descarga, verifica la huella e instala con el instalador del sistema', async () => {
    const p = fakePlatform();
    const st = await p.svc.check();
    expect(p.requested[0]).toBe('/mobile/app/latest');
    expect(st).toMatchObject({ phase: 'available', kind: 'optional', promptNow: true, info: { version: '0.3.0' } });
    await p.svc.download();
    expect(p.svc.state).toMatchObject({ phase: 'ready', progress: null, error: null });
    expect(p.hashed).toBe(1); expect(p.files.get('/cache/update-0.3.0.apk')!.length).toBe(apk.length);
    await p.svc.install();
    expect(p.installs).toEqual(['/cache/update-0.3.0.apk']); expect(p.svc.state.phase).toBe('ready');
  });

  it('huella distinta: el archivo se descarta y NO se instala; tamaño distinto igual', async () => {
    const p = fakePlatform({ latest: async () => info({ sha256: sha(Buffer.from('otra cosa')) }) });
    await p.svc.check(); await p.svc.download();
    expect(p.svc.state).toMatchObject({ phase: 'error', resumable: false }); expect(p.svc.state.error).toMatch(/SHA-256/);
    expect(p.files.size).toBe(0);
    await p.svc.install(); expect(p.installs).toEqual([]);
    const q = fakePlatform({ latest: async () => info({ sizeBytes: apk.length + 1 }) });
    await q.svc.check(); await q.svc.download();
    expect(q.svc.state.error).toBeTruthy(); expect(q.installs).toEqual([]);
  });

  it('descarga interrumpida: queda reanudable y al reintentar continúa donde quedó, sin repetir lo recibido', async () => {
    let first = true; const calls: Array<{ from: number } | null> = [];
    const stream = async (range: { from: number } | null) => { calls.push(range); const r = await server({ failAfter: first ? 5000 : Infinity }).request(range); first = false; return r; };
    const p = fakePlatform({ stream });
    await p.svc.check(); await p.svc.download();
    expect(p.svc.state).toMatchObject({ phase: 'error', resumable: true }); expect(p.svc.state.error).toMatch(/continúa donde quedó/);
    await p.svc.download();
    expect(p.svc.state.phase).toBe('ready'); expect(calls).toEqual([null, { from: 5000 }]);
  });

  it('sin red al consultar no cambia nada; sin sesión (401) marca la descarga manual desde el ERP', async () => {
    const offline = fakePlatform({ latest: async () => { throw new ApiError(0, 'NETWORK_ERROR', 'Sin conexión'); } });
    expect((await offline.svc.check()).phase).toBe('idle');
    const noSession = fakePlatform({ latest: async () => { throw new ApiError(401, 'UNAUTHORIZED', 'x'); } });
    expect(await noSession.svc.check()).toMatchObject({ phase: 'idle', manualOnly: true });
  });

  it('versión obsoleta: obligatoria, sin «más tarde»; «más tarde» solo en opcionales y se recuerda 24 h', async () => {
    const m = fakePlatform({ latest: async () => info({ mandatory: true }) });
    await m.svc.check(); expect(m.svc.state).toMatchObject({ kind: 'mandatory', promptNow: true });
    m.svc.postpone(); expect(m.svc.state.promptNow).toBe(true); // no se puede aplazar
    const o = fakePlatform();
    await o.svc.check(); o.svc.postpone(); expect(o.svc.state.promptNow).toBe(false);
    o.advance(CHECK_INTERVAL_MS + 1);
    await o.svc.check(); expect(o.svc.state).toMatchObject({ kind: 'optional', promptNow: false }); // misma versión: silenciada
    o.advance(POSTPONE_MS + 1);
    await o.svc.check(); expect(o.svc.state.promptNow).toBe(true);
  });

  it('no consulta más de una vez cada 6 h salvo que se fuerce', async () => {
    const p = fakePlatform();
    await p.svc.check(); await p.svc.check();
    expect(p.requested.filter((r) => r === '/mobile/app/latest')).toHaveLength(1);
    await p.svc.check({ force: true });
    expect(p.requested.filter((r) => r === '/mobile/app/latest')).toHaveLength(2);
  });

  it('ya instalada la versión nueva: no ofrece nada y limpia lo descargado', async () => {
    const p = fakePlatform({ latest: async () => info({ version: '0.2.0', updateAvailable: false }) });
    p.files.set('/cache/update-0.3.0.apk', Buffer.from(apk));
    await p.svc.check();
    expect(p.svc.state).toMatchObject({ kind: 'none', phase: 'idle' }); expect(p.files.size).toBe(0);
  });

  it('con el archivo ya descargado y verificable no vuelve a bajarlo; ruta de descarga insegura → error', async () => {
    const p = fakePlatform();
    p.files.set('/cache/update-0.3.0.apk', Buffer.from(apk));
    expect((await p.svc.check()).phase).toBe('ready');
    await p.svc.download(); expect(p.requested.some((r) => r.includes('latest/file'))).toBe(false); expect(p.svc.state.phase).toBe('ready');
    const bad = fakePlatform({ latest: async () => info({ downloadPath: 'https://evil.example/a.apk' }) });
    await bad.svc.check(); expect(bad.svc.state.phase).toBe('error'); await bad.svc.download(); expect(bad.requested.some((r) => r.includes('evil'))).toBe(false);
  });

  it('si el instalador falla, el archivo sigue listo y se informa', async () => {
    const p = fakePlatform({ installFails: true });
    await p.svc.check(); await p.svc.download(); await p.svc.install();
    expect(p.svc.state).toMatchObject({ phase: 'ready' }); expect(p.svc.state.error).toMatch(/instalador/);
  });
});

describe('ApiClient.stream', () => {
  it('manda Authorization, Range y dispositivo; renueva la sesión ante un 401 y devuelve 206 tal cual', async () => {
    let n = 0;
    const f = fakeFetch({
      'POST /auth/refresh': { body: { data: { accessToken: 'nuevo', refreshToken: 'r2' } } },
      'GET /mobile/app/latest/file': (_u: URL, init: RequestInit) => { n++; const h = init.headers as Record<string, string>; return h.authorization === 'Bearer nuevo' ? { status: 206, body: { ok: true } } : { status: 401, body: { error: 'UNAUTHORIZED' } }; },
    });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '0.2.0', tokens: memoryTokens('r1'), fetchImpl: f.impl, getDeviceId: () => 'dev-1' });
    api.setAccessToken('viejo');
    const res = await api.stream('/mobile/app/latest/file', { range: { from: 100 } });
    expect(res.status).toBe(206); expect(n).toBe(2);
    const last = f.calls.filter((c) => c.path === '/mobile/app/latest/file').at(-1)!;
    expect(last.headers).toMatchObject({ authorization: 'Bearer nuevo', range: 'bytes=100-', 'x-device-id': 'dev-1', 'x-app-version': '0.2.0' });
  });
  it('un error del servidor lanza ApiError y un corte de red NETWORK_ERROR', async () => {
    const f = fakeFetch({ 'GET /mobile/app/latest/file': { status: 404, body: { error: 'NOT_FOUND', message: 'APK' } } });
    const api = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens('r'), fetchImpl: f.impl });
    await expect(api.stream('/mobile/app/latest/file')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    const down = new ApiClient({ baseUrl: 'https://erp.test', appVersion: '1', tokens: memoryTokens('r'), fetchImpl: (async () => { throw new TypeError('x'); }) as never });
    await expect(down.stream('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
