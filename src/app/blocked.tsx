import { useSession } from '../core/session/hooks';
import { session } from '../core/services';
import { Button, Muted, Screen, Title } from '../ui/kit';

export default function Blocked() {
  const blocked = useSession((s) => s.blocked);
  const revoked = blocked?.reason === 'DEVICE_REVOKED';
  return (
    <Screen>
      <Title>{revoked ? 'Dispositivo bloqueado' : 'Actualización requerida'}</Title>
      <Muted>{blocked?.message}</Muted>
      <Muted>{revoked ? 'Contacte a la administración para rehabilitar este teléfono.' : 'Instale la versión más reciente de la aplicación para continuar.'}</Muted>
      <Button title="Reintentar" kind="secondary" onPress={() => void session.start()} />
    </Screen>
  );
}
