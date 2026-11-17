import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { db } from '../core/services';
import { createBluetoothTransport, getSavedPrinter, type PairedPrinter, PrintError, printReceipt, savePrinter } from '../features/printing/bluetoothPrinter';
import { testReceiptLines } from '../features/printing/receipt58';
import { Badge, Banner, Busy, Button, colors, ErrorText, Muted, Screen } from '../ui/kit';

const transport = createBluetoothTransport();

/** Impresora térmica Bluetooth de 58 mm (MP58-04): elegir entre las emparejadas y probar. El emparejamiento se hace antes en Ajustes de Android (PIN 0000 o 1234). */
export default function PrinterScreen() {
  const [saved, setSaved] = useState<PairedPrinter | null>(() => getSavedPrinter(db));
  const [devices, setDevices] = useState<PairedPrinter[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const search = useCallback(async () => {
    setBusy(true); setError(null); setOk(null);
    try {
      if (!(await transport.ensureReady())) { setError('Se necesita el permiso de Bluetooth y que esté activado.'); return; }
      setDevices(await transport.listPaired());
    } catch { setError('No se pudo leer la lista de dispositivos Bluetooth.'); } finally { setBusy(false); }
  }, []);

  function choose(p: PairedPrinter) { savePrinter(db, p); setSaved(p); setOk(`Impresora elegida: ${p.name}`); }
  async function test() {
    setBusy(true); setError(null); setOk(null);
    try { await printReceipt(transport, saved, testReceiptLines(saved?.name ?? '')); setOk('Prueba enviada.'); }
    catch (e) { setError(e instanceof PrintError ? e.message : 'No se pudo imprimir.'); } finally { setBusy(false); }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Impresora' }} />
      <Banner>Empareje la impresora en Ajustes → Bluetooth de Android (PIN 0000 o 1234) y luego elíjala aquí.</Banner>
      <Muted>{saved ? `Elegida: ${saved.name} (${saved.address})` : 'Aún no hay impresora elegida.'}</Muted>
      <Button title="Buscar impresoras emparejadas" disabled={busy} onPress={() => void search()} />
      {devices?.length === 0 && <Muted>No hay dispositivos emparejados. Empareje la impresora primero.</Muted>}
      {devices?.map((d) => (
        <Pressable key={d.address} onPress={() => choose(d)} style={[s.row, saved?.address === d.address && s.rowOn]} accessibilityRole="button" accessibilityLabel={`Elegir ${d.name}`}>
          <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: '600' }}>{d.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{d.address}</Text></View>
          {saved?.address === d.address && <Badge text="Elegida" tone="ok" />}
        </Pressable>
      ))}
      <ErrorText>{error}</ErrorText>
      {ok && <Muted>{ok}</Muted>}
      <Button title="Imprimir prueba" kind="secondary" disabled={busy || !saved} onPress={() => void test()} />
      <Busy show={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.ok },
});
