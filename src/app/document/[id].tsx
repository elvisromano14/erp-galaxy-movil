import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { formatMoney, formatNumber, formatQty } from '../../core/format';
import { db } from '../../core/services';
import { deleteDraft, type DocumentView, duplicateDocument, getDocument } from '../../db/repositories/documents';
import { toBs } from '../../features/documents/calc';
import { buildPdfData } from '../../features/documents/pdfData';
import { currencyOf, latestRate } from '../../features/documents/pricing';
import { shareDocumentPdf } from '../../features/documents/sharePdf';
import { Badge, Banner, Busy, Button, colors, ErrorText, Muted, Screen } from '../../ui/kit';
import { STATUS_LABEL } from '../(tabs)/documents';

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [v, setV] = useState<DocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { setV(getDocument(db, id)); }, [id]));

  if (!v) return <Screen><Muted>El documento ya no está en este teléfono.</Muted></Screen>;
  const d = v.doc;
  const cur = currencyOf(db, d.currencyId);
  const rate = latestRate(db, d.currencyId);
  const st = STATUS_LABEL[d.localStatus] ?? { text: d.localStatus, tone: 'muted' as const };

  async function sharePdf() {
    setBusy(true); setError(null);
    try { if ((await shareDocumentPdf(buildPdfData(db, v!))) === 'unavailable') setError('Este teléfono no puede compartir archivos.'); }
    catch { setError('No se pudo generar el PDF.'); } finally { setBusy(false); }
  }
  function duplicate() { const copy = duplicateDocument(db, d.id); router.replace({ pathname: '/document/editor', params: { id: copy } }); }
  function remove() {
    Alert.alert('Eliminar borrador', '¿Eliminar este borrador?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => { deleteDraft(db, d.id); router.back(); } }]);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: v.displayNumber }} />
      <Text style={s.title}>{d.docType === 'ORDER' ? 'Pedido' : 'Cotización'} {v.displayNumber}</Text>
      <Muted>{v.customerName ?? 'Sin cliente'}</Muted>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Badge text={st.text} tone={st.tone} />
        {d.serverStatus && <Badge text={`Servidor: ${d.serverStatus}`} tone="muted" />}
      </View>
      {d.localStatus === 'PENDING_SYNC' && <Banner>Pendiente de envío{d.serverNumber ? '' : ` — número provisional ${d.localNumber}; el definitivo llega al sincronizar`}.</Banner>}
      {d.localStatus === 'REJECTED' && <Banner>El servidor rechazó el documento: {v.lastOpError}. Corríjalo y vuelva a enviarlo.</Banner>}
      {d.localStatus === 'NEEDS_REVIEW' && <Banner>En revisión por administración: {v.lastOpError}</Banner>}
      {d.localNumber && d.serverNumber && <Muted>Número provisional en el teléfono: {d.localNumber}</Muted>}

      <Text style={s.section}>Productos</Text>
      {v.lines.map((l) => (
        <View key={l.id} style={s.line}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{l.sku}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{formatQty(l.quantity)} × {formatMoney(l.unitPrice, cur)}{Number(l.discountPct) ? ` · desc. ${formatNumber(l.discountPct, 2)} %` : ''}</Text>
          </View>
          <Text style={{ fontWeight: '600', color: colors.text }}>{formatMoney(l.lineTotal, cur)}</Text>
        </View>
      ))}
      <View style={s.totals}>
        <Row k="Subtotal" v={formatMoney(d.subtotal, cur)} /><Row k="IVA" v={formatMoney(d.taxTotal, cur)} /><Row k={`TOTAL ${cur?.code ?? ''}`} v={formatMoney(d.total, cur)} bold />
        {rate && cur?.code !== 'VES' && <Muted>≈ Bs {formatNumber(toBs(d.total, rate.rate), 2)} · tasa {formatNumber(rate.rate, 2)} ({rate.date})</Muted>}
        {d.localStatus !== 'SYNCED' && <Muted>Totales estimados; el servidor confirma precios e impuestos al sincronizar.</Muted>}
      </View>
      <Muted>{d.paymentCondition === 'CREDIT' ? `Crédito ${d.creditDays} días` : 'Contado'}{d.validUntil ? ` · válida hasta ${d.validUntil}` : ''}{d.notes ? ` · ${d.notes}` : ''}</Muted>

      <ErrorText>{error}</ErrorText>
      <Button title="Compartir PDF" disabled={busy} onPress={() => void sharePdf()} />
      <Busy show={busy} />
      {v.editable && <Button title={d.localStatus === 'REJECTED' ? 'Corregir y reenviar' : 'Editar'} kind="secondary" onPress={() => router.push({ pathname: '/document/editor', params: { id: d.id } })} />}
      <Button title="Duplicar" kind="secondary" onPress={duplicate} />
      {d.localStatus === 'DRAFT' && <Button title="Eliminar borrador" kind="danger" onPress={remove} />}
    </Screen>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontWeight: bold ? '700' : '400', fontSize: bold ? 18 : 14 }}>{k}</Text><Text style={{ color: colors.text, fontWeight: bold ? '700' : '600', fontSize: bold ? 18 : 14 }}>{v}</Text></View>
);
const s = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  totals: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
});
