import { useEffect } from 'react';
import { useSession } from '../core/session/hooks';
import { session, updater } from '../core/services';
import { UpdatePanel } from '../ui/UpdatePanel';
import { Button, Muted, Screen, Title } from '../ui/kit';

export default function Blocked() {
  const blocked = useSession((s) => s.blocked);
  const revoked = blocked?.reason === 'DEVICE_REVOKED';
  // Versión obsoleta: se ofrece descargar e instalar la nueva aquí mismo (si hay sesión; si no, la descarga es manual desde el ERP).
  useEffect(() => { if (!revoked) void updater.check({ force: true }); }, [revoked]);
  return (
    <Screen scroll>
      <Title>{revoked ? 'Dispositivo bloqueado' : 'Actualización requerida'}</Title>
      <Muted>{blocked?.message}</Muted>
      <Muted>{revoked ? 'Contacte a la administración para rehabilitar este teléfono.' : 'Instale la versión más reciente de la aplicación para continuar.'}</Muted>
      {!revoked && <UpdatePanel />}
      {!revoked && <Muted>Si no puede actualizar desde aquí, descargue la app en Configuración → App móvil del ERP (enlace o código QR) e instálela.</Muted>}
      <Button title="Reintentar" kind="secondary" onPress={() => void session.start()} />
    </Screen>
  );
}
