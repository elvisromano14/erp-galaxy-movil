import { PermissionsAndroid, Platform } from 'react-native';
import { getMeta, setMeta } from '../../db/meta';
import type { AppDb } from '../../db/types';
import { receiptEscPos, toHex, type ReceiptLine } from './receipt58';

export interface PairedPrinter { name: string; address: string }

/** Transporte hacia la impresora (Bluetooth clásico, perfil SPP). Se abstrae para poder probar el flujo sin teléfono. */
export interface PrinterTransport {
  /** Pide los permisos y la activación de Bluetooth; devuelve false si el usuario los niega. */
  ensureReady(): Promise<boolean>;
  listPaired(): Promise<PairedPrinter[]>;
  send(address: string, bytes: Uint8Array): Promise<void>;
}

const META_KEY = 'printer_58mm';
export const getSavedPrinter = (db: AppDb): PairedPrinter | null => { try { const raw = getMeta(db, META_KEY); return raw ? (JSON.parse(raw) as PairedPrinter) : null; } catch { return null; } };
export const savePrinter = (db: AppDb, p: PairedPrinter) => setMeta(db, META_KEY, JSON.stringify(p));

/** Las impresoras baratas tienen un búfer pequeño: se envía en bloques con una pausa corta. */
export const CHUNK = 256;
const PAUSE_MS = 40;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PrintError extends Error {
  constructor(public code: 'PERMISSION' | 'BT_OFF' | 'NO_PRINTER' | 'CONNECT' | 'WRITE', message: string) { super(message); }
}

/** Envía el recibo; siempre desconecta al terminar. Traduce los fallos a mensajes claros para el vendedor. */
export async function printReceipt(transport: PrinterTransport, printer: PairedPrinter | null, lines: ReceiptLine[]): Promise<void> {
  if (!printer) throw new PrintError('NO_PRINTER', 'Elija primero la impresora en Más → Impresora.');
  if (!(await transport.ensureReady())) throw new PrintError('PERMISSION', 'Se necesita el permiso de Bluetooth y que esté activado.');
  const bytes = receiptEscPos(lines);
  try { await transport.send(printer.address, bytes); }
  catch (e) { throw e instanceof PrintError ? e : new PrintError('WRITE', 'No se pudo imprimir. Verifique que la impresora esté encendida, con papel y cerca del teléfono.'); }
}

/** Transporte real con `react-native-bluetooth-classic` (requiere un build de desarrollo / producción; no corre en Expo Go). */
export function createBluetoothTransport(): PrinterTransport {
  // Carga perezosa: en pruebas y en Expo Go el módulo nativo no existe.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lib = () => (require('react-native-bluetooth-classic') as typeof import('react-native-bluetooth-classic')).default;
  return {
    async ensureReady() {
      if (Platform.OS !== 'android') return false;
      if (Number(Platform.Version) >= 31) {
        const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]);
        if (Object.values(r).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) return false;
      }
      const bt = lib();
      if (await bt.isBluetoothEnabled()) return true;
      try { return await bt.requestBluetoothEnabled(); } catch { return false; }
    },
    async listPaired() {
      return (await lib().getBondedDevices()).map((d) => ({ name: d.name || d.address, address: d.address })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async send(address, bytes) {
      const bt = lib();
      let device;
      try { device = (await bt.isDeviceConnected(address)) ? await bt.getConnectedDevice(address) : await bt.connectToDevice(address, { delimiter: '', charset: 'latin1' } as never); }
      catch { throw new PrintError('CONNECT', 'No se pudo conectar con la impresora. Enciéndala y verifique que esté emparejada.'); }
      try {
        for (let i = 0; i < bytes.length; i += CHUNK) {
          await device.write(toHex(bytes.subarray(i, i + CHUNK)), 'hex');
          if (i + CHUNK < bytes.length) await sleep(PAUSE_MS);
        }
      } finally { try { await device.disconnect(); } catch { /* ya desconectada */ } }
    },
  };
}
