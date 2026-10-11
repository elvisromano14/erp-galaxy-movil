import { useEffect } from 'react';
import { session } from '../core/services';
import { useSession } from '../core/session/hooks';
import { Busy, Button, ErrorText, Muted, Screen, Title } from '../ui/kit';

const LABEL: Record<string, string> = {
  app_settings: 'Ajustes', taxes: 'Impuestos', exchange_rates: 'Tasas de cambio', price_lists: 'Listas de precios', warehouses: 'Depósitos', customers: 'Clientes',
  products: 'Productos', product_prices: 'Precios', stock_snapshots: 'Existencias', my_documents: 'Mis documentos',
};

/** Descarga inicial del catálogo: reanudable (si se corta, continúa donde quedó) y cancelable. */
export default function Bootstrap() {
  const busy = useSession((s) => s.busy);
  const progress = useSession((s) => s.bootstrap);
  const error = useSession((s) => s.error);

  useEffect(() => { void session.bootstrap(); return () => session.cancelBootstrap(); }, []);

  return (
    <Screen scroll>
      <Title>Descargando datos</Title>
      <Muted>Se guardan en este teléfono para que pueda trabajar sin señal.</Muted>
      {progress && <Muted>{LABEL[progress.entity] ?? progress.entity}: {progress.loaded} ({progress.index} de {progress.total})</Muted>}
      <Busy show={busy} />
      <ErrorText>{error}</ErrorText>
      {busy ? <Button title="Cancelar" kind="secondary" onPress={() => session.cancelBootstrap()} /> : <Button title="Continuar la descarga" onPress={() => void session.bootstrap()} />}
    </Screen>
  );
}
