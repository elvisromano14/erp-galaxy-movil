import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CompanyChoice } from '../core/auth/AuthService';
import { ApiError } from '../core/api/errors';
import { auth } from '../core/services';

/** Login → (selección de empresa) → registro del dispositivo. La sincronización inicial (bootstrap) llega en M1. */
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<CompanyChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function finish() {
    const d = await auth.registerDevice();
    setMessage({ ok: true, text: `Dispositivo ${d.deviceCode} registrado` });
    router.replace('/');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage(null);
    try { await fn(); } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Error desconocido' });
    } finally { setBusy(false); }
  }

  const login = () => run(async () => {
    const r = await auth.login(email, password);
    if (r.requiresCompanySelection) setCompanies(r.companies);
    else await finish();
  });
  const choose = (id: string) => run(async () => { await auth.selectCompany(id); await finish(); });

  return (
    <View style={s.container}>
      {!companies ? (
        <>
          <TextInput style={s.input} placeholder="Correo" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={s.input} placeholder="Contraseña" secureTextEntry value={password} onChangeText={setPassword} />
          <Button title="Entrar" onPress={login} disabled={busy || !email || !password} />
        </>
      ) : (
        <>
          <Text style={s.title}>Elija la empresa</Text>
          {companies.map((c) => <Button key={c.id} title={`${c.tradeName ?? c.legalName} (${c.rif})`} onPress={() => choose(c.id)} disabled={busy} />)}
        </>
      )}
      {busy && <ActivityIndicator />}
      {message && <Text style={{ color: message.ok ? '#067647' : '#b42318' }}>{message.text}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 8, padding: 12, fontSize: 16 },
});
