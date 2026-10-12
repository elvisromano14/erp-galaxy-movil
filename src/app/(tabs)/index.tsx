import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { caracasToday, formatMoney, formatNumber } from '../../core/format';
import { db, session } from '../../core/services';
import { usePermission, useSession } from '../../core/session/hooks';
import { type DocListRow, listDocuments } from '../../db/repositories/documents';
import { type DashboardStats, dashboardStats } from '../../db/repositories/stats';
import { currencyOf } from '../../features/documents/pricing';
import { Badge, Banner, Button, colors, Icon, type IconName, Muted } from '../../ui/kit';
import { STATUS_LABEL } from './documents';

/** Inicio: tablero con las cifras del vendedor (leídas de la réplica local, funciona sin conexión), alertas y últimos documentos. */
export default function Home() {
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const online = useSession((s) => s.online);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const lastSync = useSession((s) => s.lastSyncAt);
  const maintenance = useSession((s) => s.maintenance);
  const queue = useSession((s) => s.queue);
  const canQuote = usePermission('sales:quotes:create');
  const [focused, setFocused] = useState(0);
  useFocusEffect(useCallback(() => { setFocused((n) => n + 1); }, []));
  // se recalcula al volver a la pantalla, al cambiar la cola y tras cada sincronización
  const key = `${focused}|${queue.pending}|${queue.rejected}|${queue.review}|${lastSync}`;
  const data = useMemo<{ stats: DashboardStats; recent: DocListRow[] }>(() => {
    void key;
    return { stats: dashboardStats(db, `${caracasToday().slice(0, 7)}-01`), recent: listDocuments(db, { limit: 5 }) };
  }, [key]);

  const st = data.stats;
  const money = (t: { byCurrency: { currencyId: string; total: string }[] }) =>
    t.byCurrency.length === 0 ? formatNumber(0, 2) : t.byCurrency.map((c) => formatMoney(c.total, currencyOf(db, c.currencyId))).join(' · ');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.content}>
      <View style={{ gap: 2 }}>
        <Text style={s.hello}>Hola, {profile?.user.fullName?.split(' ')[0] ?? 'vendedor'}</Text>
        <Muted>{profile?.company?.tradeName ?? profile?.company?.legalName} · Última sincronización: {lastSync ? new Date(lastSync).toLocaleString('es-VE') : 'nunca'}</Muted>
      </View>
      {maintenance && <Banner>{maintenance}</Banner>}
      {!online && <Banner>Sin conexión con el servidor. Trabaja con los datos de este teléfono.</Banner>}
      {error && <Banner>{error}</Banner>}
      {(queue.rejected > 0 || queue.review > 0) && (
        <Pressable onPress={() => router.push('/sync')}><Banner>{[queue.rejected ? `${queue.rejected} operación(es) rechazada(s)` : '', queue.review ? `${queue.review} en revisión` : ''].filter(Boolean).join(' · ')} — toque para revisar</Banner></Pressable>
      )}

      <View style={s.grid}>
        <Metric icon="document-text-outline" label="Cotizaciones del mes" value={String(st.quotes.count ?? 0)} sub={money(st.quotes)} onPress={() => router.navigate('/documents')} />
        <Metric icon="cart-outline" label="Pedidos del mes" value={String(st.orders.count ?? 0)} sub={money(st.orders)} onPress={() => router.navigate('/documents')} />
        <Metric icon="cloud-upload-outline" label="Por enviar" value={String(queue.pending)} tone={queue.pending ? 'warn' : undefined} sub={queue.pending ? 'Se envían al sincronizar' : 'Todo al día'} onPress={() => router.push('/sync')} />
        <Metric icon="create-outline" label="Borradores" value={String(st.drafts ?? 0)} onPress={() => router.navigate('/documents')} />
        <Metric icon="pricetags-outline" label="Productos" value={formatNumber(st.products ?? 0, 0)} onPress={() => router.navigate('/products')} />
        <Metric icon="people-outline" label="Clientes" value={formatNumber(st.customers ?? 0, 0)} onPress={() => router.navigate('/customers')} />
        <Metric icon="alert-circle-outline" label="Sin existencia" value={formatNumber(st.outOfStock ?? 0, 0)} tone={st.outOfStock ? 'error' : undefined} onPress={() => router.navigate('/stock')} />
      </View>

      <View style={{ gap: 8 }}>
        {canQuote && <Button title="Nueva cotización" onPress={() => router.push('/document/editor')} />}
        <Button title="Sincronizar ahora" kind="secondary" disabled={busy} onPress={() => void session.sync()} />
      </View>

      <Text style={s.section}>Últimos documentos</Text>
      {data.recent.length === 0 ? <Muted>Todavía no hay documentos.</Muted> : data.recent.map((d) => {
        const stl = STATUS_LABEL[d.localStatus] ?? { text: d.localStatus, tone: 'muted' as const };
        return (
          <Pressable key={d.id} onPress={() => router.push({ pathname: '/document/[id]', params: { id: d.id } })} style={s.recent} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={s.recentNum}>{d.docType === 'ORDER' ? 'Pedido ' : ''}{d.displayNumber}</Text>
              <Text style={{ color: colors.muted }} numberOfLines={1}>{d.customerName ?? 'Sin cliente'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={s.recentNum}>{formatMoney(d.total, currencyOf(db, d.currencyId))}</Text>
              <Badge text={stl.text} tone={stl.tone} />
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Metric({ icon, label, value, sub, tone, onPress }: { icon: IconName; label: string; value: string; sub?: string; tone?: 'warn' | 'error'; onPress: () => void }) {
  const c = tone === 'error' ? colors.error : tone === 'warn' ? colors.warn : colors.text;
  return (
    <Pressable onPress={onPress} style={s.metric} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={22} color={tone ? c : colors.primary} />
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, { color: c }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={s.metricSub} numberOfLines={2}>{sub}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  hello: { color: colors.text, fontSize: 24, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 4, minHeight: 112 },
  metricLabel: { color: colors.muted, fontSize: 13 },
  metricValue: { fontSize: 26, fontWeight: '700' },
  metricSub: { color: colors.muted, fontSize: 12 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700' },
  recent: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  recentNum: { color: colors.text, fontWeight: '700' },
});
