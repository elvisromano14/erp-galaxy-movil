/** Destino de la descarga (un archivo parcial en el espacio privado de la app). */
export interface ByteSink { size(): number; truncate(): void; append(chunk: Uint8Array): void; /** Cierra el archivo abierto (se llama siempre al terminar, con o sin error). */ close?(): void }

export interface ChunkResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(reason?: unknown): Promise<void> } } | null;
}

export class DownloadCancelled extends Error { constructor() { super('Descarga cancelada'); this.name = 'DownloadCancelled'; } }
/** La conexión se cortó antes de completar el archivo: lo recibido se conserva y se puede reanudar. */
export class DownloadIncomplete extends Error { constructor(readonly received: number, readonly expected: number) { super('La descarga se interrumpió'); this.name = 'DownloadIncomplete'; } }

export interface DownloadArgs {
  /** `null` = desde el principio; `{ from }` = reanudar con `Range: bytes=from-`. */
  request(range: { from: number } | null): Promise<ChunkResponse>;
  sink: ByteSink;
  expectedSize: number;
  onProgress?(received: number, total: number): void;
  signal?: { cancelled: boolean };
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

/**
 * Descarga reanudable: si hay un parcial, pide solo lo que falta (`Range`); si el servidor ignora el rango (200) o el parcial no sirve
 * (416 / más grande de lo esperado), empieza de cero. Verifica `Content-Range` para no pegar trozos desalineados. No verifica la huella
 * (eso lo hace el llamador con SHA-256 al terminar).
 */
export async function downloadWithResume(a: DownloadArgs): Promise<{ resumedFrom: number }> {
  let from = a.sink.size();
  if (from > a.expectedSize) { a.sink.truncate(); from = 0; }
  if (from === a.expectedSize) return { resumedFrom: from };

  let res = await a.request(from > 0 ? { from } : null);
  if (res.status === 416 && from > 0) { a.sink.truncate(); from = 0; res = await a.request(null); }

  if (res.status === 206) {
    const m = CONTENT_RANGE.exec(res.headers.get('content-range') ?? '');
    if (!m || Number(m[1]) !== from || Number(m[3]) !== a.expectedSize) { a.sink.truncate(); throw new Error('El servidor devolvió un trozo que no corresponde: se reiniciará la descarga'); }
  } else if (res.status === 200) {
    if (from > 0) { a.sink.truncate(); from = 0; } // el servidor ignoró el rango: llega el archivo completo
  } else {
    throw new Error(`El servidor respondió ${res.status}`);
  }
  if (!res.body) throw new Error('La respuesta no trae contenido');

  const reader = res.body.getReader();
  let received = from;
  a.onProgress?.(received, a.expectedSize);
  try {
    for (;;) {
      if (a.signal?.cancelled) { await reader.cancel?.().catch(() => undefined); throw new DownloadCancelled(); }
      let chunk: { done: boolean; value?: Uint8Array };
      try { chunk = await reader.read(); } catch { throw new DownloadIncomplete(a.sink.size(), a.expectedSize); }
      if (chunk.done) break;
      if (chunk.value?.length) {
        if (received + chunk.value.length > a.expectedSize) { a.sink.truncate(); throw new Error('El archivo recibido es más grande de lo publicado'); }
        a.sink.append(chunk.value);
        received += chunk.value.length;
        a.onProgress?.(received, a.expectedSize);
      }
    }
  } finally { a.sink.close?.(); }
  if (a.sink.size() !== a.expectedSize) throw new DownloadIncomplete(a.sink.size(), a.expectedSize);
  return { resumedFrom: from };
}
