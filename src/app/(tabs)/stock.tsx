import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatQty, timeAgo } from '../../core/format';
import { db } from '../../core/services';
import { listStock, listWarehouses, stockSummary, type StockRow } from '../../db/repositories/stock';
import { colors, Icon, Muted } from '../../ui/kit';

const PAGE = 50;
type View_ = 'ALL' | 'IN' | 'OUT';
const VIEWS: { key: View_; label: string }[] = [{ key: 'ALL', label: 'Todo' }, { key: 'IN', label: 'Con existencia' }, { key: 'OUT', label: 'Agotados' }];

/** Existencias: visor de solo lectura por producto y depósito (como «Inventario → Existencias» de la web, sin costos). Datos de la última sincronización. */
export default function Stock() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [view, setView] = useState<View_>('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [tick, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));
  useEffect(() => { const t = setTimeout(() => { setQuery(text); setLimit(PAGE); }, 200); return () => clearTimeout(t); }, [text]);

  const warehouses = useMemo(() => { void tick; return listWarehouses(db); }, [tick]);
  const filter = useMemo(() => ({ query, warehouseId, onlyPositive: view === 'IN', onlyEmpty: view === 'OUT' }), [query, warehouseId, view]);
  const summary = useMemo(() => { void tick; return stockSummary(db, filter); }, [filter, tick]);
  const rows = useMemo(() => { void tick; return listStock(db, { ...filter, limit }); }, [filter, limit, tick]);
  const oldest = useMemo(() => { void tick; return rows.map((r) => r.asOf).sort()[0] ?? null; }, [rows, tick]);

  return (
    <View style={s.container}>
      <View style={s.search}>
        <Icon name="search-outline" size={20} color={colors.muted} />
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="SKU, nombre u OEM" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Buscar en existencias" />
      </View>
      <View style={s.chips}>
        <Chip label="Todos los depósitos" on={warehouseId === null} onPress={() => { setWarehouseId(null); setLimit(PAGE); }} />
        {warehouses.map((w) => <Chip key={w.id} label={w.code} on={warehouseId === w.id} onPress={() => { setWarehouseId(w.id); setLimit(PAGE); }} />)}
      </View>
      <View style={s.chips}>
        {VIEWS.map((v) => <Chip key={v.key} label={v.label} on={view === v.key} onPress={() => { setView(v.key); setLimit(PAGE); }} />)}
      </View>
      <View style={s.summary}>
        <Stat label="Productos" value={String(summary.products)} />
        <Stat label="Unidades" value={formatQty(summary.units)} />
        <Stat label="Reservado" value={formatQty(summary.reserved)} />
      </View>
      <FlashList
        data={rows}
        keyExtractor={(r) => `${r.productId}-${r.warehouseId}`}
        renderItem={({ item }) => <Row item={item} onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.productId } })} />}
        onEndReached={() => rows.length >= limit && setLimit((l) => l + PAGE)}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={s.empty}><Muted>{summary.lines === 0 && !query && view === 'ALL' && !warehouseId ? 'Aún no hay existencias en este teléfono. Sincronice desde Más.' : 'Sin resultados con estos filtros.'}</Muted></View>}
      />
      <Text style={s.foot}>Existencias de la última sincronización ({timeAgo(oldest)}). Para ver la cifra en vivo abra el producto.</Text>
    </View>
  );
}

const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
    <Text style={{ color: on ? colors.onPrimary : colors.text, fontSize: 13 }}>{label}</Text>
  </Pressable>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flex: 1 }}><Text style={s.statLabel}>{label}</Text><Text style={s.statValue} numberOfLines={1}>{value}</Text></View>
);

function Row({ item, onPress }: { item: StockRow; onPress: () => void }) {
  const out = Number(item.available) <= 0;
  const hasReserved = Number(item.reserved) > 0;
  return (
    <Pressable onPress={onPress} style={s.row} accessibilityRole="button" accessibilityLabel={`${item.sku} ${item.name} ${item.warehouseCode}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.sku}>{item.sku} · {item.warehouseCode}</Text>
        <Text style={s.name} numberOfLines={2}>{item.name}</Text>
        {hasReserved && <Text style={s.reserved}>Reservado {formatQty(item.reserved)} de {formatQty(item.quantity)}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.qty, out && { color: colors.error }]}>{formatQty(item.available)}</Text>
        <Text style={s.unit}>{out ? 'sin disponible' : `disp.${item.unitCode ? ` ${item.unitCode}` : ''}`}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 0, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card },
  input: { flex: 1, paddingVertical: 10, fontSize: 16, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primaryBg, borderColor: colors.primaryBg },
  summary: { flexDirection: 'row', gap: 12, margin: 12, padding: 12, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  statLabel: { color: colors.muted, fontSize: 12 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'center' },
  sku: { color: colors.muted, fontSize: 12 },
  name: { color: colors.text, fontWeight: '600' },
  reserved: { color: colors.warn, fontSize: 12 },
  qty: { color: colors.ok, fontSize: 20, fontWeight: '700' },
  unit: { color: colors.muted, fontSize: 11 },
  empty: { padding: 24, alignItems: 'center' },
  foot: { color: colors.muted, fontSize: 12, textAlign: 'center', padding: 10 },
});
