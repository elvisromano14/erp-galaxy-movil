import { Alert } from 'react-native';
import { session } from '../../core/services';
import { useSession } from '../../core/session/hooks';
import { Banner, Busy, Button, ErrorText, Muted, Screen, Title } from '../../ui/kit';

/** Inicio (M1): estado de la sesión y de la sincronización. Los módulos de negocio llegan en M2+. */
export default function Home() {
  const profile = useSession((s) => s.profile);
  const device = useSession((s) => s.deviceCode);
  const online = useSession((s) => s.online);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const lastSync = useSession((s) => s.lastSyncAt);
  const maintenance = useSession((s) => s.maintenance);

  function logout() {
    const pending = session.pendingCount();
    const go = () => void session.logout();
    if (pending === 0) return go();
    Alert.alert('Hay operaciones pendientes', `${pending} operación(es) aún no se han enviado. Se conservarán en este teléfono y se enviarán cuando vuelva a iniciar sesión. ¿Cerrar sesión?`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar sesión', style: 'destructive', onPress: go },
    ]);
  }

  return (
    <Screen scroll>
      <Title>{profile?.company?.tradeName ?? profile?.company?.legalName ?? 'ERP Ventas'}</Title>
      <Muted>{profile?.user.fullName} · dispositivo {device}</Muted>
      {maintenance && <Banner>{maintenance}</Banner>}
      {!online && <Banner>Sin conexión con el servidor. Trabaja con los datos de este teléfono.</Banner>}
      <Muted>Última sincronización: {lastSync ? new Date(lastSync).toLocaleString('es-VE') : 'nunca'}</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Sincronizar ahora" disabled={busy} onPress={() => void session.sync()} />
      <Busy show={busy} />
      <Button title="Bloquear" kind="secondary" onPress={() => session.lock()} />
      <Button title="Cerrar sesión" kind="secondary" onPress={logout} />
    </Screen>
  );
}
