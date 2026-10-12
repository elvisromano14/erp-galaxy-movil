import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { db } from '../../core/services';
import { useAnyPermission } from '../../core/session/hooks';
import { type CustomerListRow, searchCustomers } from '../../db/repositories/customers';
import { Badge, Button, colors, Muted } from '../../ui/kit';

const PAGE = 50;

/** Cartera de clientes del vendedor (local). Los creados en el teléfono llevan su estado de envío. */
export default function Customers() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [tick, setTick] = useState(0);
  const canCreate = useAnyPermission('admin:customers:create');

  useEffect(() => { const t = setTimeout(() => { setQuery(text); setLimit(PAGE); }, 200); return () => clearTimeout(t); }, [text]);
  // al volver de crear/editar o de sincronizar se refresca la lista
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));
  const rows = useMemo(() => { void tick; return searchCustomers(db, { query, limit }); }, [query, limit, tick]);

  return (
    <View style={s.container}>
      <View style={s.bar}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="RIF, razón social o teléfono" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Buscar cliente" />
        {canCreate && <Button title="Nuevo" onPress={() => router.push('/customer/form')} />}
      </View>
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Row item={item} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: item.id } })} />}
        onEndReached={() => rows.length >= limit && setLimit((l) => l + PAGE)}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={s.empty}><Muted>{query ? `Sin resultados para «${query}».` : 'No hay clientes en su cartera. Sincronice o cree uno nuevo.'}</Muted></View>}
      />
    </View>
  );
}

export function SyncBadge({ sync }: { sync: CustomerListRow['sync'] }) {
  if (sync === 'LOCAL_PENDING') return <Badge text="Sin enviar" tone="warn" />;
  if (sync === 'REJECTED') return <Badge text="Rechazado" tone="error" />;
  if (sync === 'REVIEW') return <Badge text="En revisión" tone="warn" />;
  return null;
}

function Row({ item, onPress }: { item: CustomerListRow; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.row} accessibilityRole="button" accessibilityLabel={`${item.legalName} ${item.rif}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.name} numberOfLines={1}>{item.legalName}</Text>
        <Text style={s.muted}>{item.rif}{item.phone ? ` · ${item.phone}` : ''}</Text>
      </View>
      <View style={{ gap: 4, alignItems: 'flex-end' }}>
        <SyncBadge sync={item.sync} />
        {item.validationStatus === 'PENDING' && !item.sync && <Badge text="Por validar" tone="warn" />}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  bar: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'center' },
  name: { fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  empty: { padding: 24, alignItems: 'center' },
});
