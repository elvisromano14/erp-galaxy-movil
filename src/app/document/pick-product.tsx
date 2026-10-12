import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { caracasToday, formatMoney, formatQty } from '../../core/format';
import { db } from '../../core/services';
import { defaultCurrency, searchProducts } from '../../db/repositories/products';
import { pick } from '../../features/documents/pickerStore';
import { Button, colors, Muted } from '../../ui/kit';

/** Selector de producto para una línea (búsqueda local o escáner). */
export default function PickProduct() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(text), 200); return () => clearTimeout(t); }, [text]);
  const currency = useMemo(() => defaultCurrency(db), []);
  const rows = useMemo(() => searchProducts(db, { query, limit: 100, today: caracasToday() }), [query]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' }}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="SKU, nombre, OEM o código" placeholderTextColor={colors.muted} autoCapitalize="none" autoFocus accessibilityLabel="Buscar producto" />
        <Button title="Escanear" kind="secondary" onPress={() => router.push({ pathname: '/scan', params: { pick: '1' } })} />
      </View>
      <FlashList
        data={rows} keyExtractor={(r) => r.id} keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => { pick('product', item.id); router.back(); }} accessibilityRole="button" accessibilityLabel={`${item.sku} ${item.name}`}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>{item.sku}</Text><Text style={{ color: colors.muted }} numberOfLines={2}>{item.name}</Text></View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{item.price !== null ? formatMoney(item.price, currency) : 'Sin precio'}</Text>
              <Text style={{ color: item.available > 0 ? colors.ok : colors.error, fontSize: 12 }}>{item.isService ? 'Servicio' : item.available > 0 ? `${formatQty(item.available)} disp.` : 'Sin existencia'}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<View style={{ padding: 24 }}><Muted>Sin resultados.</Muted></View>}
      />
    </View>
  );
}
const s = StyleSheet.create({
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'center' },
});
