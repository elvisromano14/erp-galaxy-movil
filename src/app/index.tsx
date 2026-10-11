import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AppConfig } from '../core/api/contract';
import { ApiError } from '../core/api/errors';
import { api, env } from '../core/services';

/** Pantalla inicial (M0): comprueba que la app llega al ERP y muestra versiones. El acceso completo llega en M1. */
export default function Home() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AppConfig>('/app/config', { auth: false }).then(setCfg).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Error desconocido'));
  }, []);

  return (
    <View style={s.container}>
      <Text style={s.title}>ERP Ventas</Text>
      <Text style={s.muted}>Entorno {env.appEnv} · versión {env.appVersion}</Text>
      <Text style={s.muted}>{env.apiUrl}</Text>
      {!cfg && !error && <ActivityIndicator style={{ marginTop: 24 }} />}
      {error && <Text style={s.error}>Sin conexión con el servidor: {error}</Text>}
      {cfg && <Text style={s.ok}>Servidor al día · versión mínima de la app {cfg.minAppVersion}</Text>}
      <Link href="/login" style={s.link}>Iniciar sesión</Link>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  muted: { color: '#667085' },
  ok: { color: '#067647', marginTop: 16 },
  error: { color: '#b42318', marginTop: 16 },
  link: { marginTop: 32, fontSize: 18, color: '#175cd3' },
});
