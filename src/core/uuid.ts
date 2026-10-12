/**
 * UUID v7 (RFC 9562): 48 bits de milisegundos + aleatorio. Los ids se generan EN EL DISPOSITIVO (clientEntityId / clientOpId):
 * al ser ordenables por tiempo, el índice de SQLite queda compacto. Requiere `crypto.getRandomValues`
 * (en Hermes lo aporta `react-native-get-random-values`, cargado al inicio de la app).
 */
export function uuidv7(now: number = Date.now(), random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const b = random(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; // versión 7
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
