import 'react-native-get-random-values'; // debe cargarse primero (uuid v7 en Hermes)
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { ActivityIndicator, Text, View } from 'react-native';
import { db } from '../db/client';
import migrations from '../db/migrations/migrations';

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);
  if (error) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}><Text style={{ color: '#b42318' }}>No se pudo preparar la base local: {error.message}</Text></View>;
  }
  if (!success) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }}>
        <Stack.Screen name="index" options={{ title: 'ERP Ventas' }} />
        <Stack.Screen name="login" options={{ title: 'Iniciar sesión' }} />
      </Stack>
    </>
  );
}
