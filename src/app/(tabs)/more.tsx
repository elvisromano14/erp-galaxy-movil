import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { env, session } from '../../core/services';
import { useSession } from '../../core/session/hooks';
import { Banner, Button, colors, Muted, Screen, Title } from '../../ui/kit';

/** Más: perfil, sincronización, diagnóstico y acciones de la sesión. */
export default function More() {
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const device = useSession((s) => s.deviceCode);
  const online = useSession((s) => s.online);
  const maintenance = useSession((s) => s.maintenance);
  const queue = useSession((s) => s.queue);

  function logout() {
    const pending = session.pendingCount();
    const go = () => void session.logout();
    if (pending === 0) return go();
    Alert.alert('Hay operaciones pendientes', `${pending} operación(es) aún no se han enviado. Se conservarán en este teléfono y se enviarán cuando vuelva a iniciar sesión. ¿Cerrar sesión?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar sesión', style: 'destructive', onPress: go }]);
  }
  function reset() {
    const pending = queue.pending + queue.rejected + queue.review;
    Alert.alert('Restablecer datos descargados', `Se borrarán los catálogos y clientes descargados y se volverán a bajar${pending ? `. Sus ${pending} operación(es) pendientes NO se pierden` : ''}. Requiere conexión. ¿Continuar?`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Restablecer', style: 'destructive', onPress: () => session.resetReplica() },
    ]);
  }

  return (
    <Screen scroll>
      <Title>{profile?.user.fullName ?? 'Más'}</Title>
      <View style={s.card}>
        <Line k="Empresa" v={profile?.company?.tradeName ?? profile?.company?.legalName ?? '—'} />
        <Line k="Dispositivo" v={device ?? '—'} />
        <Line k="Versión" v={`${env.appVersion} (${env.appEnv})`} />
        <Line k="Conexión" v={online ? 'En línea' : 'Sin conexión'} />
      </View>
      {maintenance && <Banner>{maintenance}</Banner>}
      <Button title="Cola de sincronización" kind="secondary" onPress={() => router.push('/sync')} />
      <Button title="Diagnóstico" kind="secondary" onPress={() => router.push('/diagnostics')} />
      <Button title="Restablecer datos descargados" kind="secondary" onPress={reset} />
      <Button title="Bloquear ahora" kind="secondary" onPress={() => session.lock()} />
      <Button title="Cerrar sesión" kind="danger" onPress={logout} />
      <Muted>Restablecer y cerrar sesión no borran sus operaciones pendientes de envío.</Muted>
    </Screen>
  );
}

const Line = ({ k, v }: { k: string; v: string }) => <View style={s.line}><Text style={{ color: colors.muted }}>{k}</Text><Text style={{ color: colors.text, fontWeight: '600' }}>{v}</Text></View>;
const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
