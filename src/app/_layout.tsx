import 'react-native-get-random-values'; // debe cargarse primero (uuid v7 en Hermes)
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { useSession } from '../core/session/hooks';
import type { SessionStatus } from '../core/session/SessionService';
import { session } from '../core/services';
import { startSyncTriggers } from '../sync/triggers';
import { registerBackgroundSync } from '../sync/backgroundTask';
import { db } from '../db/client';
import { colors } from '../ui/kit';
import migrations from '../db/migrations/migrations';

/** Pantalla que corresponde a cada estado de la sesión (la navegación la gobierna el estado, no la UI). */
const ROUTE: Record<Exclude<SessionStatus, 'booting'>, string> = {
  anonymous: '/login', 'needs-company': '/company', 'needs-pin': '/pin-setup', locked: '/unlock', 'needs-bootstrap': '/bootstrap', ready: '/', blocked: '/blocked',
};

const GATES = ['/login', '/company', '/pin-setup', '/unlock', '/bootstrap', '/blocked'];

function Gate() {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => { void session.start(); return startSyncTriggers(session); }, []);
  // La tarea periódica en segundo plano se registra cuando la sesión está lista (complementaria: no está garantizada por el sistema).
  useEffect(() => { if (status === 'ready') void registerBackgroundSync(); }, [status]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? session.onForeground() : st === 'background' ? session.onBackground() : undefined));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (status === 'booting') return;
    const target = ROUTE[status];
    // los grupos de rutas «(tabs)» no forman parte de la ruta visible
    const here = `/${(segments as string[]).filter((x) => !x.startsWith('(')).join('/')}`;
    // Listo: cualquier pantalla de la app es válida; solo se sale de las de acceso (login, PIN, descarga…).
    const ok = status === 'ready' ? !GATES.includes(here) : here === target;
    if (!ok) router.replace(target as never);
  }, [status, segments, router]);

  if (status === 'booting') return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0c111d' }}><ActivityIndicator color="#2e90fa" /></View>;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text } }}>
      <Stack.Screen name="product/[id]" options={{ headerShown: true, title: 'Producto' }} />
      <Stack.Screen name="customer/[id]" options={{ headerShown: true, title: 'Cliente' }} />
      <Stack.Screen name="customer/form" options={{ headerShown: true, title: 'Cliente' }} />
      <Stack.Screen name="document/editor" options={{ headerShown: true, title: 'Cotización' }} />
      <Stack.Screen name="document/[id]" options={{ headerShown: true, title: 'Cotización' }} />
      <Stack.Screen name="document/pick-customer" options={{ headerShown: true, title: 'Elegir cliente', presentation: 'modal' }} />
      <Stack.Screen name="document/pick-product" options={{ headerShown: true, title: 'Agregar producto', presentation: 'modal' }} />
      <Stack.Screen name="diagnostics" options={{ headerShown: true, title: 'Diagnóstico' }} />
      <Stack.Screen name="sync" options={{ headerShown: true, title: 'Sincronización' }} />
      <Stack.Screen name="scan" options={{ headerShown: true, title: 'Escanear código', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);
  if (error) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0c111d' }}><Text style={{ color: '#f97066' }}>No se pudo preparar la base local: {error.message}</Text></View>;
  }
  if (!success) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0c111d' }}><ActivityIndicator color="#2e90fa" /></View>;
  return (
    <>
      <StatusBar style="light" />
      <Gate />
    </>
  );
}
