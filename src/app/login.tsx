import { useState } from 'react';
import { env, session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { Busy, Button, ErrorText, Field, Muted, Screen, Title } from '../ui/kit';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);

  return (
    <Screen scroll>
      <Title>ERP Ventas</Title>
      <Muted>Entorno {env.appEnv} · versión {env.appVersion}</Muted>
      <Field label="Correo" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Field label="Contraseña" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
      <ErrorText>{error}</ErrorText>
      <Button title="Entrar" disabled={busy || !email.trim() || !password} onPress={() => void session.login(email, password)} />
      <Busy show={busy} />
      <Muted>El primer acceso requiere conexión. Después podrá abrir la app con su PIN, también sin señal.</Muted>
    </Screen>
  );
}
