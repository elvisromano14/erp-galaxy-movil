import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { LiveStock } from '../../core/api/contract';
import { caracasToday, formatMoney, formatNumber, formatQty, timeAgo } from '../../core/format';
import { api, db, session } from '../../core/services';
import { usePermission, useSession } from '../../core/session/hooks';
import { getProductDetail } from '../../db/repositories/products';
import { fetchLiveStock } from '../../features/products/liveStock';
import { Banner, Busy, Button, ErrorText, Muted, Screen, colors } from '../../ui/kit';

export default function ProductDetail() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const today = caracasToday();
  const detail = useMemo(() => getProductDetail(db, id, today), [id, today]);
  const router = useRouter();
  const canLive = usePermission('inventory:stock:read');
  const canQuote = usePermission('sales:quotes:create');
  const online = useSession((st) => st.online);
  const [live, setLive] = useState<LiveStock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLive() {
    setBusy(true); setError(null);
    try { setLive(await fetchLiveStock(api, id ?? '')); } catch (e) { setError(session.reportError(e)); } finally { setBusy(false); }
  }

  if (!detail) return <Screen><Muted>El producto ya no está en este teléfono.</Muted></Screen>;
  const oldest = detail.stock.map((x) => x.asOf).sort()[0] ?? null;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: detail.sku }} />
      <Text style={s.name}>{detail.name}</Text>
      {canQuote && <Button title="Nueva cotización con este producto" onPress={() => router.push({ pathname: '/document/editor', params: { addProductId: detail.id } })} />}
      <Muted>{[detail.categoryName, detail.unitCode, detail.tax ? `${detail.tax.name}` : 'Sin impuesto'].filter(Boolean).join(' · ')}</Muted>
      {detail.description ? <Text style={{ color: colors.text }}>{detail.description}</Text> : null}

      <Section title="Precios">
        {detail.prices.length === 0 && <Muted>Sin precios vigentes.</Muted>}
        {detail.prices.map((p) => (
          <Line key={p.priceListId} left={`${p.listName}${p.isDefault ? ' (por omisión)' : ''}`} right={formatMoney(p.price, p)} />
        ))}
        {detail.tax && Number(detail.tax.rate) > 0 && <Muted>Los precios no incluyen {detail.tax.name} ({formatNumber(detail.tax.rate, 0)} %).</Muted>}
      </Section>

      <Section title="Existencias">
        {detail.isService && <Muted>Es un servicio: no maneja existencias.</Muted>}
        {!detail.isService && detail.stock.length === 0 && <Muted>Sin existencias registradas.</Muted>}
        {detail.stock.map((w) => (
          <Line key={w.warehouseId} left={`${w.name} (${w.code})`} right={`${formatQty(Number(w.quantity) - Number(w.reserved))} disp.`} sub={`${formatQty(w.quantity)} en total · ${formatQty(w.reserved)} reservado`} />
        ))}
        {oldest && <Muted>Datos sincronizados {timeAgo(oldest)}.</Muted>}
        {canLive && (
          <>
            {live && live.warehouses.map((w) => (
              <Line key={`live-${w.warehouseId}`} left={`En vivo · ${w.name}`} right={`${formatQty(w.available)} disp.`} sub={`${formatQty(w.quantity)} en total · ${formatQty(w.reserved)} reservado`} />
            ))}
            {live && <Muted>Consultado {timeAgo(live.asOf)}.</Muted>}
            {!online && <Banner>Sin conexión: se muestran las existencias sincronizadas.</Banner>}
            <ErrorText>{error}</ErrorText>
            <Button title="Ver existencia en vivo" kind="secondary" disabled={busy} onPress={() => void loadLive()} />
            <Busy show={busy} />
          </>
        )}
      </Section>

      {detail.references.length > 0 && (
        <Section title="Referencias y equivalentes">
          {detail.references.map((r) => <Line key={`${r.kind}-${r.code}`} left={r.code} right={`${KIND[r.kind] ?? r.kind}${r.brand ? ` · ${r.brand}` : ''}`} />)}
        </Section>
      )}
      {detail.barcodes.length > 0 && (
        <Section title="Códigos de barras">
          {detail.barcodes.map((b) => <Text key={b} style={{ color: colors.text }}>{b}</Text>)}
        </Section>
      )}
    </Screen>
  );
}

const KIND: Record<string, string> = { OEM: 'OEM', EQUIVALENT: 'Equivalente', ALTERNATE: 'Alterno' };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ gap: 8, marginTop: 8 }}>
    <Text style={s.section}>{title}</Text>
    {children}
  </View>
);

const Line = ({ left, right, sub }: { left: string; right: string; sub?: string }) => (
  <View style={s.line}>
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.text }}>{left}</Text>
      {sub ? <Text style={{ color: colors.muted, fontSize: 12 }}>{sub}</Text> : null}
    </View>
    <Text style={{ color: colors.text, fontWeight: '600' }}>{right}</Text>
  </View>
);

const s = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
