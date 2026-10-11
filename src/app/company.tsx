import { session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { Busy, Button, ErrorText, Muted, Screen, Title } from '../ui/kit';

export default function Company() {
  const companies = useSession((s) => s.companies);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  return (
    <Screen scroll>
      <Title>Elija la empresa</Title>
      <Muted>La empresa queda fija en este teléfono. Para cambiarla hay que cerrar sesión y volver a entrar.</Muted>
      {companies.map((c) => (
        <Button key={c.id} title={`${c.tradeName ?? c.legalName} (${c.rif})`} disabled={busy} kind="secondary" onPress={() => void session.chooseCompany(c.id)} />
      ))}
      <ErrorText>{error}</ErrorText>
      <Busy show={busy} />
      <Button title="Cancelar" kind="secondary" onPress={() => void session.logout()} />
    </Screen>
  );
}
