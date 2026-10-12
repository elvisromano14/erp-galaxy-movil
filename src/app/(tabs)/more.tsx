import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { env, session } from '../../core/services';
import { useSession } from '../../core/session/hooks';
import { Banner, Busy, Button, Card, colors, ErrorText, Muted, Screen, Title } from '../../ui/kit';

/** Más: acciones de la sesión (sincronizar, cola, bloquear, cerrar sesión), diagnóstico y datos del equipo. */
export default function More() {
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const device = useSession((s) => s.deviceCode);
  const online = useSession((s) => s.online);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const lastSync = useSession((s) => s.lastSyncAt);
  const maintenance = useSession((s) => s.maintenance);
  const queue = useSession((s) => s.queue);
  const waiting = queue.pending + queue.rejected + queue.review;

  function logout() {
    const pending = session.pendingCount();
    const go = () => void session.logout();
    if (pending === 0) return go();
    Alert.alert('Hay operaciones pendientes', `${pending} operación(es) aún no se han enviado. Se conservarán en este teléfono y se enviarán cuando vuelva a iniciar sesión. ¿Cerrar sesión?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar sesión', style: 'destructive', onPress: go }]);
  }
  function reset() {
    Alert.alert('Restablecer datos descargados', `Se borrarán los catálogos y clientes descargados y se volverán a bajar${waiting ? `. Sus ${waiting} operación(es) pendientes NO se pierden` : ''}. Requiere conexión. ¿Continuar?`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Restablecer', style: 'destructive', onPress: () => session.resetReplica() },
    ]);
  }

  return (
    <Screen scroll>
      <Title>{profile?.user.fullName ?? 'Más'}</Title>
      <Card>
        <Line k="Empresa" v={profile?.company?.tradeName ?? profile?.company?.legalName ?? '—'} />
        <Line k="Dispositivo" v={device ?? '—'} />
        <Line k="Versión" v={`${env.appVersion} (${env.appEnv})`} />
        <Line k="Conexión" v={online ? 'En línea' : 'Sin conexión'} />
        <Line k="Última sincronización" v={lastSync ? new Date(lastSync).toLocaleString('es-VE') : 'nunca'} />
      </Card>
      {maintenance && <Banner>{maintenance}</Banner>}
      <ErrorText>{error}</ErrorText>
      <Button title="Sincronizar ahora" disabled={busy} onPress={() => void session.sync()} />
      <Busy show={busy} />
      <Button title={waiting ? `Cola de sincronización (${waiting})` : 'Cola de sincronización'} kind="secondary" onPress={() => router.push('/sync')} />
      <Button title="Bloquear" kind="secondary" onPress={() => session.lock()} />
      <Button title="Cerrar sesión" kind="danger" onPress={logout} />
      <View style={{ height: 8 }} />
      <Button title="Diagnóstico" kind="secondary" onPress={() => router.push('/diagnostics')} />
      <Button title="Restablecer datos descargados" kind="secondary" onPress={reset} />
      <Muted>Restablecer y cerrar sesión no borran sus operaciones pendientes de envío.</Muted>
    </Screen>
  );
}

const Line = ({ k, v }: { k: string; v: string }) => <View style={s.line}><Text style={{ color: colors.muted }}>{k}</Text><Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text></View>;
const s = StyleSheet.create({ line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 } });
