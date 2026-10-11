import { useEffect, useState } from 'react';
import { session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { Banner, Button, ErrorText, Field, Muted, Screen, Title } from '../ui/kit';

export default function Unlock() {
  const [pin, setPin] = useState('');
  const error = useSession((s) => s.error);
  const online = useSession((s) => s.online);
  const company = useSession((s) => s.profile?.company);

  // Intenta la huella al abrir (si el teléfono la tiene); el PIN siempre está disponible.
  useEffect(() => { void session.unlockWithBiometric(); }, []);

  async function submit() { const p = pin; setPin(''); await session.unlock(p); }

  return (
    <Screen scroll>
      <Title>Desbloquear</Title>
      {company && <Muted>{company.tradeName ?? company.legalName}</Muted>}
      {!online && <Banner>Sin conexión: puede trabajar con los datos de este teléfono.</Banner>}
      <Field label="PIN" keyboardType="number-pad" secureTextEntry value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} onSubmitEditing={() => void submit()} />
      <ErrorText>{error}</ErrorText>
      <Button title="Entrar" disabled={pin.length < 4} onPress={() => void submit()} />
      <Button title="Usar huella" kind="secondary" onPress={() => void session.unlockWithBiometric()} />
      <Button title="Cerrar sesión" kind="secondary" onPress={() => void session.logout()} />
    </Screen>
  );
}
