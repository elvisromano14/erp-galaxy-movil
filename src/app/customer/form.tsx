import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { CustomerError, createCustomerLocal, getCustomer, updateCustomerLocal } from '../../db/repositories/customers';
import { db, session } from '../../core/services';
import { isValidRif } from '../../vendor/erp-domain';
import { Button, ErrorText, Field, Muted, Screen } from '../../ui/kit';

/** Alta y edición de clientes (sin conexión): se valida el RIF con el mismo código del servidor y se encola el envío. */
export default function CustomerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const editing = id ? getCustomer(db, id) : null;
  const [rif, setRif] = useState(editing?.rif ?? '');
  const [legalName, setLegalName] = useState(editing?.legalName ?? '');
  const [tradeName, setTradeName] = useState(editing?.tradeName ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const rifError = !editing && rif.trim().length >= 5 && !isValidRif(rif) ? 'RIF inválido (ejemplo: J-12345678-9)' : null;
  const valid = (editing || isValidRif(rif)) && legalName.trim().length >= 2;

  function save() {
    setError(null); setExisting(null);
    try {
      const row = editing ? updateCustomerLocal(db, editing.id, { legalName, tradeName, phone, email, address }) : createCustomerLocal(db, { rif, legalName, tradeName, phone, email, address });
      session.refreshQueue();
      session.requestSync(); // se envía solo cuando haya conexión
      if (editing) router.back(); else router.replace({ pathname: '/customer/[id]', params: { id: row.id } });
    } catch (e) {
      if (e instanceof CustomerError) { setError(e.message); if (e.code === 'DUPLICATE_RIF') setExisting(e.existingId ?? null); } else setError('No se pudo guardar el cliente.');
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: editing ? 'Editar cliente' : 'Nuevo cliente' }} />
      <Field label="RIF" value={rif} onChangeText={setRif} autoCapitalize="characters" editable={!editing} placeholder="J-12345678-9" />
      <ErrorText>{rifError}</ErrorText>
      <Field label="Razón social" value={legalName} onChangeText={setLegalName} />
      <Field label="Nombre comercial (opcional)" value={tradeName} onChangeText={setTradeName} />
      <Field label="Teléfono (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Correo (opcional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Dirección (opcional)" value={address} onChangeText={setAddress} />
      <ErrorText>{error}</ErrorText>
      {existing && <Button title="Ver el cliente existente" kind="secondary" onPress={() => router.replace({ pathname: '/customer/[id]', params: { id: existing } })} />}
      <Button title="Guardar" disabled={!valid} onPress={save} />
      <Muted>Queda pendiente de validación por administración y se envía automáticamente cuando haya conexión.</Muted>
    </Screen>
  );
}
