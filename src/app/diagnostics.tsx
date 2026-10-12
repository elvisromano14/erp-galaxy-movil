import { Stack } from 'expo-router';
import { useMemo } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { db, env } from '../core/services';
import { exportLog, getLog } from '../core/telemetry/log';
import { collectDiagnostics } from '../features/diagnostics/collect';
import { Button, colors, Muted, Screen } from '../ui/kit';

/** Diagnóstico para soporte: versión, base local, cursores, cola, últimas sincronizaciones y registro (sin datos personales). */
export default function Diagnostics() {
  const d = useMemo(() => collectDiagnostics(db), []);
  const log = getLog();
  const mb = (n: number) => `${(n / 1_048_576).toFixed(2)} MB`;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Diagnóstico' }} />
      <Section title="Aplicación"><Row k="Versión" v={`${env.appVersion} (${env.appEnv})`} /><Row k="Servidor" v={env.apiUrl} /><Row k="Cifrado de la base" v={env.sqlcipher ? 'Activo' : 'No (compilación sin SQLCIPHER)'} /></Section>
      <Section title="Base local"><Row k="Migraciones aplicadas" v={String(d.migrations)} /><Row k="Tamaño" v={mb(d.dbSizeBytes)} />{Object.entries(d.tables).map(([k, n]) => <Row key={k} k={k} v={String(n)} />)}</Section>
      <Section title="Sincronización">
        <Row k="Descarga inicial" v={d.meta.bootstrapDoneAt ?? 'pendiente'} /><Row k="Última sincronización" v={d.meta.lastSyncAt ?? 'nunca'} /><Row k="Dispositivo" v={d.meta.deviceCode ?? '—'} />
        <Row k="Cola" v={`${d.queue.PENDING + d.queue.SENDING} pendientes · ${d.queue.REJECTED} rechazadas · ${d.queue.REVIEW} en revisión · ${d.queue.DONE} enviadas`} />
        {d.lastSyncs.map((h, i) => <Muted key={i}>{h.startedAt} · {h.finishedAt ? (h.ok ? 'correcta' : 'incompleta') : 'en curso'}</Muted>)}
        {Object.entries(d.cursors).filter(([, v]) => v).map(([k, v]) => <Muted key={k}>cursor {k}: {v}</Muted>)}
      </Section>
      <Section title={`Registro (${log.length})`}>
        {log.slice(-15).map((e, i) => <Muted key={i}>{e.at.slice(11, 19)} {e.level} [{e.tag}] {e.message}</Muted>)}
        <Button title="Compartir registro" kind="secondary" onPress={() => void Share.share({ message: exportLog() || 'Registro vacío' })} />
      </Section>
    </Screen>
  );
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <View style={{ gap: 4, marginTop: 8 }}><Text style={s.title}>{title}</Text>{children}</View>;
const Row = ({ k, v }: { k: string; v: string }) => <View style={s.row}><Text style={{ color: colors.muted, flex: 1 }}>{k}</Text><Text style={{ color: colors.text, flexShrink: 1, textAlign: 'right' }}>{v}</Text></View>;
const s = StyleSheet.create({ title: { fontSize: 16, fontWeight: '700', color: colors.text }, row: { flexDirection: 'row', gap: 12, paddingVertical: 2 } });
