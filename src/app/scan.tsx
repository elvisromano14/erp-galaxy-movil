import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { pick } from '../features/documents/pickerStore';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { db } from '../core/services';
import { findByCode } from '../db/repositories/products';
import { Button, Muted, Screen, Title, colors } from '../ui/kit';

const TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr', 'datamatrix'] as const;

/** Escáner de códigos de barras (cámara). Los lectores Bluetooth/Zebra funcionan como teclado en el buscador. */
export default function Scan() {
  const router = useRouter();
  const { pick: picking } = useLocalSearchParams<{ pick?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [notFound, setNotFound] = useState<string | null>(null);
  const handling = useRef(false); // evita procesar varias lecturas del mismo código

  if (!permission) return <Screen><Muted>Preparando la cámara…</Muted></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Title>Permiso de cámara</Title>
        <Muted>Se usa la cámara solo para leer códigos de barras de productos.</Muted>
        <Button title="Permitir cámara" onPress={() => void requestPermission()} />
        <Button title="Escribir el código" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  function onScan(data: string) {
    if (handling.current) return;
    handling.current = true;
    const hit = findByCode(db, data);
    if (hit && picking) { pick('product', hit.id); router.dismissAll(); return; }
    if (hit) { router.replace({ pathname: '/product/[id]', params: { id: hit.id } }); return; }
    setNotFound(data);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: [...TYPES] }} onBarcodeScanned={notFound ? undefined : (r) => onScan(r.data)} />
      <View style={s.overlay}>
        {notFound ? (
          <View style={s.card}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>No se encontró «{notFound}»</Text>
            <Button title="Buscar como texto" onPress={() => router.replace({ pathname: '/products', params: { q: notFound, t: String(Date.now()) } })} />
            <Button title="Escanear otro" kind="secondary" onPress={() => { handling.current = false; setNotFound(null); }} />
          </View>
        ) : (
          <Text style={s.hint}>Apunte al código de barras</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', padding: 24 },
  hint: { color: '#fff', textAlign: 'center', fontSize: 16, backgroundColor: '#00000088', padding: 10, borderRadius: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 10 },
});
