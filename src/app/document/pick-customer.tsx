import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { db } from '../../core/services';
import { searchCustomers } from '../../db/repositories/customers';
import { pick } from '../../features/documents/pickerStore';
import { Badge, colors, Muted } from '../../ui/kit';

/** Selector de cliente para un documento (modal). */
export default function PickCustomer() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(text), 200); return () => clearTimeout(t); }, [text]);
  const rows = useMemo(() => searchCustomers(db, { query, limit: 100 }), [query]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TextInput style={s.input} value={text} onChangeText={setText} placeholder="RIF o razón social" placeholderTextColor={colors.muted} autoCapitalize="none" autoFocus accessibilityLabel="Buscar cliente" />
      <FlashList
        data={rows} keyExtractor={(r) => r.id} keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => { pick('customer', item.id); router.back(); }} accessibilityRole="button">
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>{item.legalName}</Text><Text style={{ color: colors.muted }}>{item.rif}</Text></View>
            {item.validationStatus === 'PENDING' && <Badge text="Por validar" tone="warn" />}
          </Pressable>
        )}
        ListEmptyComponent={<View style={{ padding: 24 }}><Muted>Sin resultados. Cree el cliente desde la pestaña Clientes.</Muted></View>}
      />
    </View>
  );
}
const s = StyleSheet.create({
  input: { margin: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'center' },
});
