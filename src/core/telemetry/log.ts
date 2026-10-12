import { scrub, scrubText } from './scrub';

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry { at: string; level: LogLevel; tag: string; message: string; data?: unknown }

const MAX = 300;
const entries: LogEntry[] = [];
let reporter: ((e: unknown, ctx: Record<string, unknown>) => void) | null = null;

/** Registro local en memoria (anillo de 300) para la pantalla de diagnóstico. Nunca guarda datos personales ni tokens. */
export function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  entries.push({ at: new Date().toISOString(), level, tag, message: scrubText(message), ...(data !== undefined ? { data: scrub(data) } : {}) });
  if (entries.length > MAX) entries.shift();
}

export const logger = {
  info: (tag: string, message: string, data?: unknown) => log('info', tag, message, data),
  warn: (tag: string, message: string, data?: unknown) => log('warn', tag, message, data),
  error: (tag: string, message: string, data?: unknown) => log('error', tag, message, data),
};

export const getLog = (): readonly LogEntry[] => entries;
export const clearLog = () => { entries.length = 0; };
export const exportLog = () => entries.map((e) => `${e.at} ${e.level.toUpperCase()} [${e.tag}] ${e.message}${e.data !== undefined ? ` ${JSON.stringify(e.data)}` : ''}`).join('\n');

/**
 * Conecta un servicio de errores (p. ej. Sentry) cuando se defina un DSN: recibe SOLO contexto depurado.
 * Sin reportero configurado, los errores quedan en el registro local.
 */
export function setErrorReporter(fn: ((e: unknown, ctx: Record<string, unknown>) => void) | null) { reporter = fn; }
export function reportException(e: unknown, ctx: Record<string, unknown> = {}) {
  logger.error('exception', e instanceof Error ? e.message : String(e), ctx);
  try { reporter?.(e instanceof Error ? new Error(scrubText(e.message)) : e, scrub(ctx) as Record<string, unknown>); } catch { /* el reporte nunca rompe la app */ }
}
