import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { db, session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { listQueue, type OutboxRow } from '../db/repositories/outbox';
import { syncLog } from '../db/schema';
import { desc } from 'drizzle-orm';
import { explainError } from '../features/documents/explain';
import { Badge, Banner, Busy, Button, colors, ErrorText, Muted, Screen } from '../ui/kit';

const ENTITY: Record<string, string> = { customer: 'cliente', sales_quote: 'cotización', sales_order: 'pedido' };
const ACTION: Record<string, string> = { create: 'Alta', update: 'Cambio' };
const TONE: Record<string, 'muted' | 'warn' | 'error' | 'ok'> = { PENDING: 'warn', SENDING: 'warn', REJECTED: 'error', REVIEW: 'warn', DONE: 'ok' };
const LABEL: Record<string, string> = { PENDING: 'Pendiente', SENDING: 'Enviando', REJECTED: 'Rechazada', REVIEW: 'En revisión', DONE: 'Enviada' };

function title(o: OutboxRow) {
  let name = '';
  try { const p = JSON.parse(o.payloadJson); name = p.legalName ?? p.notes ?? ''; } catch { /* sin datos */ }
  return `${ACTION[o.action] ?? o.action} de ${ENTITY[o.entity] ?? o.entity}${name ? `: ${name}` : ''}`;
}

/** Cola de sincronización: qué falta enviar, qué rechazó el servidor y las últimas sincronizaciones. */
export default function SyncScreen() {
  const router = useRouter();
  const busy = useSession((s) => s.busy);
  const online = useSession((s) => s.online);
  const queueState = useSession((s) => s.queue);
  const lastSync = useSession((s) => s.lastSyncAt);
  const error = useSession((s) => s.error);
  const [tick, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));
  const queue = (() => { void tick; void queueState; return listQueue(db); })();
  const history = (() => { void tick; void queueState; return db.select().from(syncLog).orderBy(desc(syncLog.id)).limit(5).all(); })();

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Sincronización' }} />
      <Muted>Última sincronización: {lastSync ? new Date(lastSync).toLocaleString('es-VE') : 'nunca'}</Muted>
      {!online && <Banner>Sin conexión con el servidor. Las operaciones se enviarán solas cuando vuelva la señal.</Banner>}
      <ErrorText>{error}</ErrorText>
      <Button title="Sincronizar ahora" disabled={busy} onPress={() => void session.sync()} />
      <Busy show={busy} />

      <Text style={s.section}>Cola de envío ({queue.length})</Text>
      {queue.length === 0 && <Muted>Todo está enviado.</Muted>}
      {queue.map((o) => (
        <View key={o.clientOpId} style={s.item}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: '600' }} numberOfLines={2}>{title(o)}</Text>
            <Badge text={LABEL[o.status] ?? o.status} tone={TONE[o.status] ?? 'muted'} />
          </View>
          <Muted>{new Date(o.createdAt).toLocaleString('es-VE')}{o.attempts > 0 ? ` · ${o.attempts} intento(s)` : ''}</Muted>
          {o.lastError ? <Text style={{ color: o.status === 'REJECTED' ? colors.error : colors.warn }}>{explainError(o.lastError)}</Text> : null}
          {(o.entity === 'sales_quote' || o.entity === 'sales_order') && (o.status === 'REJECTED' || o.status === 'REVIEW') && <Button title="Abrir documento" kind="secondary" onPress={() => router.push({ pathname: '/document/[id]', params: { id: o.entityId } })} />}
          {o.status === 'REJECTED' && o.entity === 'customer' && <Button title="Corregir" kind="secondary" onPress={() => router.push({ pathname: '/customer/form', params: { id: o.entityId } })} />}
        </View>
      ))}

      <Text style={s.section}>Últimas sincronizaciones</Text>
      {history.length === 0 && <Muted>Sin registros.</Muted>}
      {history.map((h) => (
        <Muted key={h.id}>{new Date(h.startedAt).toLocaleString('es-VE')} · {h.finishedAt ? (h.ok ? 'correcta' : 'incompleta') : 'en curso'}</Muted>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12 },
  item: { gap: 4, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
