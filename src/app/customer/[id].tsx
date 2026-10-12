import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../../core/format';
import { db } from '../../core/services';
import { useSession } from '../../core/session/hooks';
import { type CustomerDetail, getCustomer } from '../../db/repositories/customers';
import { Badge, Banner, Button, colors, Muted, Screen } from '../../ui/kit';

const BS = { symbol: 'Bs', decimals: 2 };

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lastSync = useSession((st) => st.lastSyncAt);
  const [c, setC] = useState<CustomerDetail | null>(null);
  useFocusEffect(useCallback(() => { setC(getCustomer(db, id)); }, [id]));

  if (!c) return <Screen><Muted>El cliente ya no está en este teléfono.</Muted></Screen>;
  const op = c.lastOp;
  const failed = op?.status === 'REJECTED';

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Cliente' }} />
      <Text style={s.name}>{c.legalName}</Text>
      <Muted>{c.rif}{c.tradeName ? ` · ${c.tradeName}` : ''}</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {c.validationStatus === 'PENDING' ? <Badge text="Pendiente de validación" tone="warn" /> : <Badge text="Validado" tone="ok" />}
        {(op?.status === 'PENDING' || op?.status === 'SENDING') && <Badge text="Sin enviar" tone="warn" />}
        {failed && <Badge text="Rechazado" tone="error" />}
        {op?.status === 'REVIEW' && <Badge text="En revisión" tone="warn" />}
      </View>
      {failed && <Banner>El servidor rechazó el alta: {op?.lastError}. Corrija los datos y se reenviará.</Banner>}
      {c.validationStatus === 'PENDING' && !failed && <Banner>Cliente nuevo: puede usarlo en cotizaciones y pedidos, pero administración debe validarlo antes de facturarle.</Banner>}

      <Section title="Contacto">
        <Line k="Teléfono" v={c.phone} /><Line k="Correo" v={c.email} /><Line k="Dirección" v={c.address} />
      </Section>
      <Section title="Crédito (indicativo)">
        <Line k="Límite" v={Number(c.creditLimit) > 0 ? formatMoney(c.creditLimit, BS) : 'Sin límite'} />
        <Line k="Días de crédito" v={String(c.creditDays)} />
        <Line k="Saldo pendiente" v={formatMoney(c.balanceSnapshot, BS)} />
        <Line k="Vencido" v={formatMoney(c.overdueSnapshot, BS)} />
        {c.availableCredit !== null && <Line k="Disponible" v={formatMoney(c.availableCredit, BS)} />}
        <Muted>Saldos al corte de la última sincronización{lastSync ? ` (${new Date(lastSync).toLocaleString('es-VE')})` : ''}. El servidor valida el crédito al confirmar.</Muted>
      </Section>

      {c.editable && <Button title={failed ? 'Corregir y reenviar' : 'Editar'} kind="secondary" onPress={() => router.push({ pathname: '/customer/form', params: { id: c.id } })} />}
    </Screen>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ gap: 6, marginTop: 8 }}><Text style={s.section}>{title}</Text>{children}</View>
);
const Line = ({ k, v }: { k: string; v: string | null }) => (
  <View style={s.line}><Text style={{ color: colors.muted }}>{k}</Text><Text style={{ color: colors.text, fontWeight: '600' }}>{v || '—'}</Text></View>
);
const s = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
