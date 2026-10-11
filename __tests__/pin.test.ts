import { MAX_PIN_ATTEMPTS, PinLock, shouldLock } from '../src/core/auth/PinLock';
import { versionLt } from '../src/core/version';
import { memoryPin, nodeHasher } from './helpers';


describe('PinLock', () => {
  it('guarda sal y resumen, nunca el PIN; verifica y reinicia los intentos al acertar', async () => {
    const st = memoryPin(); const pin = new PinLock(st, nodeHasher);
    expect(await pin.isSet()).toBe(false);
    await pin.setPin('1234');
    expect(JSON.stringify(st.rec)).not.toContain('1234');
    expect(await pin.verify('0000')).toBe('WRONG'); expect(await pin.attemptsLeft()).toBe(MAX_PIN_ATTEMPTS - 1);
    expect(await pin.verify('1234')).toBe('OK'); expect(await pin.attemptsLeft()).toBe(MAX_PIN_ATTEMPTS);
  });

  it('la misma clave con sal distinta da un resumen distinto', async () => {
    const a = memoryPin(); const b = memoryPin();
    await new PinLock(a, nodeHasher).setPin('4321'); await new PinLock(b, nodeHasher).setPin('4321');
    expect(a.rec!.hash).not.toBe(b.rec!.hash);
  });

  it('tras 5 intentos fallidos queda bloqueado (exige login) aunque luego acierte', async () => {
    const pin = new PinLock(memoryPin(), nodeHasher); await pin.setPin('123456');
    const r: string[] = [];
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) r.push(await pin.verify('000000'));
    expect(r).toEqual(['WRONG', 'WRONG', 'WRONG', 'WRONG', 'LOCKED_OUT']);
    expect(await pin.verify('123456')).toBe('LOCKED_OUT');
  });

  it('valida el formato (4 a 6 dígitos)', async () => {
    const pin = new PinLock(memoryPin(), nodeHasher);
    for (const bad of ['123', '1234567', 'abcd', '12 34', '']) await expect(pin.setPin(bad)).rejects.toThrow('4 a 6 dígitos');
  });
});

describe('inactividad y versiones', () => {
  it('shouldLock: solo si estuvo en segundo plano más del tiempo', () => {
    expect(shouldLock(null, 1000, 300)).toBe(false);
    expect(shouldLock(1000, 1200, 300)).toBe(false);
    expect(shouldLock(1000, 1300, 300)).toBe(true);
  });
  it('versionLt compara x.y.z', () => {
    expect(versionLt('1.0.0', '1.0.1')).toBe(true); expect(versionLt('1.2.0', '1.10.0')).toBe(true);
    expect(versionLt('2.0.0', '1.9.9')).toBe(false); expect(versionLt('1.0.0', '1.0.0')).toBe(false); expect(versionLt('1.0.0-beta', '1.0.0')).toBe(false);
  });
});
