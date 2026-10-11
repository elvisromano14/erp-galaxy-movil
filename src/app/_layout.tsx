import 'react-native-get-random-values'; // debe cargarse primero (uuid v7 en Hermes)
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { useSession } from '../core/session/hooks';
import type { SessionStatus } from '../core/session/SessionService';
import { session } from '../core/services';
import { db } from '../db/client';
import migrations from '../db/migrations/migrations';

/** Pantalla que corresponde a cada estado de la sesión (la navegación la gobierna el estado, no la UI). */
const ROUTE: Record<Exclude<SessionStatus, 'booting'>, string> = {
  anonymous: '/login', 'needs-company': '/company', 'needs-pin': '/pin-setup', locked: '/unlock', 'needs-bootstrap': '/bootstrap', ready: '/', blocked: '/blocked',
};

function Gate() {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => { void session.start(); }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? session.onForeground() : st === 'background' ? session.onBackground() : undefined));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (status === 'booting') return;
    const target = ROUTE[status];
    const here = `/${(segments as string[]).join('/')}`;
    if (here !== target) router.replace(target as never);
  }, [status, segments, router]);

  if (status === 'booting') return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);
  if (error) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}><Text style={{ color: '#b42318' }}>No se pudo preparar la base local: {error.message}</Text></View>;
  }
  if (!success) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return (
    <>
      <StatusBar style="auto" />
      <Gate />
    </>
  );
}
