/** Registro del PIN en el almacenamiento seguro: nunca el PIN, solo sal + resumen estirado + intentos fallidos. */
export interface PinRecord { salt: string; hash: string; attempts: number }
export interface PinStorage { get(): Promise<PinRecord | null>; set(r: PinRecord): Promise<void>; clear(): Promise<void> }
export interface Hasher { randomHex(bytes: number): string; sha256(text: string): Promise<string> }

export type PinResult = 'OK' | 'WRONG' | 'LOCKED_OUT';

const ITERATIONS = 2000;
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_PATTERN = /^\d{4,6}$/;

/**
 * PIN local de 4 a 6 dígitos (el PIN nunca se envía al servidor). Protege el acceso a la UI y a los datos del teléfono:
 * tras 5 intentos fallidos se exige iniciar sesión de nuevo (`LOCKED_OUT`). El resumen vive en el Keystore (SecureStore).
 */
export class PinLock {
  constructor(private readonly storage: PinStorage, private readonly hasher: Hasher) {}

  async isSet() { return (await this.storage.get()) !== null; }

  async setPin(pin: string): Promise<void> {
    if (!PIN_PATTERN.test(pin)) throw new Error('El PIN debe tener de 4 a 6 dígitos');
    const salt = this.hasher.randomHex(16);
    await this.storage.set({ salt, hash: await this.stretch(salt, pin), attempts: 0 });
  }

  async verify(pin: string): Promise<PinResult> {
    const rec = await this.storage.get();
    if (!rec) return 'LOCKED_OUT';
    if (rec.attempts >= MAX_PIN_ATTEMPTS) return 'LOCKED_OUT';
    if (timingSafeEqual(await this.stretch(rec.salt, pin), rec.hash)) {
      if (rec.attempts) await this.storage.set({ ...rec, attempts: 0 });
      return 'OK';
    }
    const attempts = rec.attempts + 1;
    await this.storage.set({ ...rec, attempts });
    return attempts >= MAX_PIN_ATTEMPTS ? 'LOCKED_OUT' : 'WRONG';
  }

  async attemptsLeft() { const r = await this.storage.get(); return r ? Math.max(0, MAX_PIN_ATTEMPTS - r.attempts) : 0; }
  clear() { return this.storage.clear(); }

  private async stretch(salt: string, pin: string) {
    let h = `${salt}:${pin}`;
    for (let i = 0; i < ITERATIONS; i++) h = await this.hasher.sha256(`${h}:${salt}`);
    return h;
  }
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ¿Pasó el tiempo de inactividad desde que la app pasó a segundo plano? */
export const shouldLock = (backgroundedAt: number | null, now: number, timeoutMs: number) => backgroundedAt !== null && now - backgroundedAt >= timeoutMs;
