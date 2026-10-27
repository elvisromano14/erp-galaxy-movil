import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { caracasToday, formatMoney, formatQty } from '../../core/format';
import { db } from '../../core/services';
import { usePermission } from '../../core/session/hooks';
import { getAppSettings } from '../../db/repositories/settings';
import { defaultCurrency, productCount, searchProducts, type ProductRow } from '../../db/repositories/products';
import { Badge, Button, colors, Muted } from '../../ui/kit';

const PAGE = 50;

/** Catálogo local: búsqueda por SKU, nombre, OEM/equivalentes y código de barras. Funciona sin conexión. */
export default function Products() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; t?: string }>();
  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  // Búsqueda que llega del escáner («buscar como texto»): se adopta una vez por cada envío (`t` distingue repeticiones).
  const incoming = params.q ? `${params.q}|${params.t ?? ''}` : '';
  const [seen, setSeen] = useState(incoming);
  if (incoming !== seen) { setSeen(incoming); if (params.q) { setText(params.q); setQuery(params.q); } }
  const [inStock, setInStock] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const today = caracasToday();
  const hasCreatePerm = usePermission('admin:products:create');
  const allowCreate = useMemo(() => getAppSettings(db).allowProductCreate, []);
  const canCreate = hasCreatePerm && allowCreate;
  // Al volver (de crear/editar un producto o de sincronizar) se relee la lista.
  const [tick, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((t) => t + 1); }, []));

  // pausa breve al escribir para no consultar en cada tecla
  useEffect(() => { const t = setTimeout(() => { setQuery(text); setLimit(PAGE); }, 200); return () => clearTimeout(t); }, [text]);

  const total = useMemo(() => { void tick; return productCount(db); }, [tick]);
  const currency = useMemo(() => defaultCurrency(db), []);
  const rows = useMemo(() => { void tick; return searchProducts(db, { query, limit, inStockOnly: inStock, today }); }, [query, limit, inStock, today, tick]);

  return (
    <View style={s.container}>
      <View style={s.bar}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="SKU, nombre, OEM o código" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Buscar producto" />
        <Button title="Escanear" kind="secondary" onPress={() => router.push('/scan')} />
      </View>
      {canCreate && <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}><Button title="Nuevo producto" kind="secondary" onPress={() => router.push('/product/form')} /></View>}
      <View style={s.filter}>
        <Text style={{ color: colors.text }}>Solo con existencia</Text>
        <Switch value={inStock} onValueChange={(v) => { setInStock(v); setLimit(PAGE); }} accessibilityLabel="Solo con existencia" />
      </View>
      {total === 0 ? (
        <View style={s.empty}><Muted>Aún no hay productos en este teléfono. Sincronice desde Inicio.</Muted></View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <Row item={item} currency={currency} onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })} />}
          onEndReached={() => rows.length >= limit && setLimit((l) => l + PAGE)}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View style={s.empty}><Muted>Sin resultados para «{query}».</Muted></View>}
        />
      )}
    </View>
  );
}

function Row({ item, currency, onPress }: { item: ProductRow; currency: ReturnType<typeof defaultCurrency>; onPress: () => void }) {
  const out = !item.isService && item.available <= 0;
  return (
    <Pressable onPress={onPress} style={s.row} accessibilityRole="button" accessibilityLabel={`${item.sku} ${item.name}`}>
      <View style={{ flex: 1 }}>
        <Text style={s.sku}>{item.sku}</Text>
        <Text style={s.name} numberOfLines={2}>{item.name}</Text>
        {item.brand ? <Text style={s.brand} numberOfLines={1}>{item.brand}</Text> : null}
        {item.isLocal ? <View style={{ marginTop: 4 }}><Badge text="Sin enviar" tone="warn" /></View> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.price}>{item.price !== null ? formatMoney(item.price, currency) : 'Sin precio'}</Text>
        <Text style={[s.stock, out && { color: colors.error }]}>{item.isService ? 'Servicio' : out ? 'Sin existencia' : `${formatQty(item.available)} disp.`}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 16, color: colors.text },
  filter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sku: { fontWeight: '700', color: colors.text },
  name: { color: colors.muted },
  price: { fontWeight: '600', color: colors.text },
  stock: { color: colors.ok, fontSize: 12 },
  brand: { color: colors.muted, fontSize: 12 },
  empty: { padding: 24, alignItems: 'center' },
});
