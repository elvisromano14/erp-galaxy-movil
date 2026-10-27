import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { updater } from '../core/services';
import { useUpdate } from '../features/update/hooks';
import { UpdatePanel } from '../ui/UpdatePanel';
import { Screen, Title } from '../ui/kit';

/** Pantalla «Actualización de la app»: se abre sola cuando hay una versión nueva (aplazable) y desde Más → Buscar actualización. */
export default function UpdateScreen() {
  const router = useRouter();
  const kind = useUpdate((s) => s.kind);
  useEffect(() => { updater.markPrompted(); void updater.check({ force: true }); }, []);
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Actualización', headerBackVisible: kind !== 'mandatory', gestureEnabled: kind !== 'mandatory' }} />
      <Title>{kind === 'none' ? 'Actualización' : 'Hay una versión nueva'}</Title>
      <UpdatePanel onLater={() => router.back()} />
    </Screen>
  );
}
