import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../../core/format';
import { db } from '../../core/services';
import { useAllPermissions, usePermission } from '../../core/session/hooks';
import { type DocListRow, listDocuments } from '../../db/repositories/documents';
import { SERVER_STATUS_LABEL } from '../../features/documents/explain';
import { currencyOf } from '../../features/documents/pricing';
import { Badge, Button, colors, Muted } from '../../ui/kit';

const FILTERS = [
  { key: 'ALL', label: 'Todos' }, { key: 'DRAFT', label: 'Borradores' }, { key: 'PENDING_SYNC', label: 'Sin enviar' },
  { key: 'SYNCED', label: 'Enviados' }, { key: 'PROBLEMS', label: 'Con problemas' },
] as const;

export const STATUS_LABEL: Record<string, { text: string; tone: 'muted' | 'warn' | 'error' | 'ok' }> = {
  DRAFT: { text: 'Borrador', tone: 'muted' }, PENDING_SYNC: { text: 'Sin enviar', tone: 'warn' }, SYNCED: { text: 'Enviado', tone: 'ok' },
  REJECTED: { text: 'Rechazado', tone: 'error' }, NEEDS_REVIEW: { text: 'En revisión', tone: 'warn' },
};

/** Cotizaciones del vendedor (borradores, pendientes de envío, enviadas y con problemas). Los pedidos se suman en M5. */
export default function Documents() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ALL');
  const [type, setType] = useState<'ALL' | 'QUOTE' | 'ORDER'>('ALL');
  const [tick, setTick] = useState(0);
  const canQuote = usePermission('sales:quotes:create');
  const canOrder = useAllPermissions('sales:orders:create', 'sales:orders:confirm');
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));

  const rows = useMemo(() => {
    void tick;
    const all = listDocuments(db, { limit: 200, docType: type === 'ALL' ? undefined : type });
    return filter === 'ALL' ? all : filter === 'PROBLEMS' ? all.filter((r) => r.localStatus === 'REJECTED' || r.localStatus === 'NEEDS_REVIEW') : all.filter((r) => r.localStatus === filter);
  }, [filter, type, tick]);

  return (
    <View style={s.container}>
      <View style={s.chips}>
        {([['ALL', 'Todo'], ['QUOTE', 'Cotizaciones'], ['ORDER', 'Pedidos']] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setType(k)} style={[s.chip, type === k && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: type === k }}>
            <Text style={{ color: type === k ? '#fff' : colors.text, fontSize: 13 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.chips}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[s.chip, filter === f.key && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
            <Text style={{ color: filter === f.key ? '#fff' : colors.text, fontSize: 13 }}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Row item={item} onPress={() => router.push({ pathname: '/document/[id]', params: { id: item.id } })} />}
        ListEmptyComponent={<View style={s.empty}><Muted>No hay documentos en esta vista.</Muted></View>}
      />
      <View style={{ padding: 12, gap: 8 }}>
        {canQuote && <Button title="Nueva cotización" onPress={() => router.push('/document/editor')} />}
        {canOrder && <Button title="Nuevo pedido" kind="secondary" onPress={() => router.push({ pathname: '/document/editor', params: { docType: 'ORDER' } })} />}
      </View>
    </View>
  );
}

function Row({ item, onPress }: { item: DocListRow; onPress: () => void }) {
  const st = STATUS_LABEL[item.localStatus] ?? { text: item.localStatus, tone: 'muted' as const };
  const cur = currencyOf(db, item.currencyId);
  return (
    <Pressable onPress={onPress} style={s.row} accessibilityRole="button" accessibilityLabel={`${item.displayNumber} ${item.customerName ?? ''}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.num}>{item.docType === 'ORDER' ? 'Pedido ' : ''}{item.displayNumber}</Text>
        <Text style={s.muted} numberOfLines={1}>{item.customerName ?? 'Sin cliente'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={s.num}>{formatMoney(item.total, cur)}</Text>
        <Badge text={item.localStatus === 'SYNCED' && item.serverStatus ? (SERVER_STATUS_LABEL[item.serverStatus] ?? st.text) : st.text} tone={st.tone} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'center' },
  num: { fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  empty: { padding: 24, alignItems: 'center' },
});
