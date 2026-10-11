import { useState } from 'react';
import { PIN_PATTERN } from '../core/auth/PinLock';
import { session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { Button, ErrorText, Field, Muted, Screen, Title } from '../ui/kit';

export default function PinSetup() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const error = useSession((s) => s.error);
  const mismatch = confirm.length > 0 && pin !== confirm;
  const valid = PIN_PATTERN.test(pin) && pin === confirm;
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  return (
    <Screen scroll>
      <Title>Cree su PIN</Title>
      <Muted>De 4 a 6 dígitos. Protege los datos de este teléfono; no se envía al servidor.</Muted>
      <Field label="PIN" keyboardType="number-pad" secureTextEntry value={pin} onChangeText={(v) => setPin(digits(v))} />
      <Field label="Repita el PIN" keyboardType="number-pad" secureTextEntry value={confirm} onChangeText={(v) => setConfirm(digits(v))} />
      <ErrorText>{mismatch ? 'Los PIN no coinciden' : error}</ErrorText>
      <Button title="Guardar PIN" disabled={!valid} onPress={() => void session.setPin(pin)} />
    </Screen>
  );
}
