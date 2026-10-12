const SENSITIVE_KEYS = /^(password|pass|pin|token|accessToken|refreshToken|authorization|secret|apiKey|deviceKey|cookie)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RIF = /\b[VEJGPC]-?\d{8}-?\d\b/gi;
const PHONE = /\b0?(?:2\d{2}|4(?:12|14|16|24|26))[-\s]?\d{7}\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/g;

/** Enmascara texto con datos personales (correos, RIF, teléfonos, tokens) antes de registrarlo o enviarlo a un servicio de errores. */
export function scrubText(s: string): string {
  return s.replace(BEARER, 'Bearer [token]').replace(EMAIL, '[correo]').replace(RIF, '[rif]').replace(PHONE, '[teléfono]');
}

/** Copia profunda sin claves sensibles y con los textos enmascarados (profundidad acotada). */
export function scrub<T>(value: T, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[oculto]' : scrub(v, depth + 1)]));
}
