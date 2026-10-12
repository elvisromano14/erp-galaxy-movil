import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { caracasToday, formatMoney, formatNumber, formatQty } from '../../core/format';
import { db, session } from '../../core/services';
import { getCustomer } from '../../db/repositories/customers';
import { type DraftInput, type DraftLine, defaultValidUntil, getDocument, saveDraft, submitDocument } from '../../db/repositories/documents';
import { getAppSettings } from '../../db/repositories/settings';
import { computeTotals, toBs } from '../../features/documents/calc';
import { consumePick } from '../../features/documents/pickerStore';
import { currencyOf, latestRate, priceListFor, priceOf, productForLine } from '../../features/documents/pricing';
import { validateDocument } from '../../features/documents/validate';
import { Banner, Button, colors, ErrorText, Field, Muted, Screen } from '../../ui/kit';

interface EditorLine extends DraftLine { name: string }

/**
 * Editor de cotizaciones (plan §9.3): cliente → líneas → condiciones → totales en vivo con el dominio compartido.
 * Se autoguarda como borrador (al editar, al pasar a segundo plano y al salir). «Guardar y enviar» confirma localmente y encola el envío.
 */
export default function DocumentEditor() {
  const params = useLocalSearchParams<{ id?: string; customerId?: string; addProductId?: string }>();
  const router = useRouter();
  const settings = useMemo(() => getAppSettings(db), []);
  const today = caracasToday();

  const initial = useMemo(() => (params.id ? getDocument(db, params.id) : null), [params.id]);
  const [docId, setDocId] = useState<string | undefined>(initial?.doc.id);
  const [customerId, setCustomerId] = useState(initial?.doc.customerId ?? params.customerId ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => (initial?.lines ?? []).map((l) => ({ productId: l.productId, sku: l.sku, name: l.description || l.sku || '', description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId, taxRate: l.taxRate })));
  const [payment, setPayment] = useState<'CASH' | 'CREDIT'>((initial?.doc.paymentCondition as 'CASH' | 'CREDIT') ?? 'CASH');
  const [creditDays, setCreditDays] = useState(String(initial?.doc.creditDays ?? 0));
  const [validUntil, setValidUntil] = useState(initial?.doc.validUntil ?? defaultValidUntil());
  const [notes, setNotes] = useState(initial?.doc.notes ?? '');
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  const customer = useMemo(() => (customerId ? getCustomer(db, customerId) : null), [customerId]);
  const list = useMemo(() => priceListFor(db, customerId || null), [customerId]);
  const currencyId = list?.currencyId ?? settings.company?.valuationCurrencyId ?? '';
  const currency = currencyOf(db, currencyId);
  const rate = latestRate(db, currencyId);

  const input: DraftInput = useMemo(() => ({
    id: docId, docType: 'QUOTE', customerId, currencyId, paymentCondition: payment, creditDays: Number(creditDays) || 0, validUntil: validUntil || null,
    notes: notes.trim() || null, warehouseId: settings.defaultWarehouseId, lines,
  }), [docId, customerId, currencyId, payment, creditDays, validUntil, notes, settings.defaultWarehouseId, lines]);
  const totals = useMemo(() => computeTotals(lines.map((l) => ({ ...l, taxExempt: Number(l.taxRate) === 0 }))), [lines]);
  const totalBs = rate && currency?.code !== 'VES' ? toBs(totals.total, rate.rate) : null;
  const rateAge = rate ? Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${rate.date}T00:00:00Z`).getTime()) / 86_400_000) : null;
  const availableCredit = customer?.availableCredit ?? null;
  // (el compilador de React memoriza este cálculo; es barato)
  const validation = validateDocument({ db, settings, input, availableCreditBs: availableCredit, totalBs, rateAgeDays: rateAge });

  // ── autoguardado del borrador ──
  const save = useCallback(() => {
    if (!dirty.current) return docId;
    if (!input.customerId && input.lines.length === 0) return docId; // nada que guardar todavía
    const id = saveDraft(db, input);
    dirty.current = false;
    if (!docId) setDocId(id);
    return id;
  }, [input, docId]);
  const touch = () => { dirty.current = true; };
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(save, 600); return () => clearTimeout(t); }, [input, save]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') save(); }); return () => sub.remove(); }, [save]);
  useEffect(() => () => { /* al salir se guarda lo pendiente */ if (dirty.current) save(); }, [save]);

  // ── líneas ──
  const lineFor = useCallback((productId: string, overrideList = list): EditorLine | null => {
    const p = productForLine(db, productId);
    if (!p) return null;
    const price = priceOf(db, productId, overrideList?.id ?? null, today);
    return { productId, sku: p.sku, name: p.name, description: null, quantity: '1', unitPrice: price ?? '0', discountPct: '0', taxId: p.taxId, taxRate: p.taxRate };
  }, [list, today]);

  const addProduct = useCallback((productId: string) => {
    setLines((cur) => {
      const i = cur.findIndex((l) => l.productId === productId);
      if (i >= 0) return cur.map((l, k) => (k === i ? { ...l, quantity: String(Number(l.quantity) + 1) } : l)); // misma línea: suma cantidad
      const l = lineFor(productId); return l ? [...cur, l] : cur;
    });
    dirty.current = true;
  }, [lineFor]);

  const changeCustomer = useCallback((id: string) => {
    setCustomerId(id);
    const c = getCustomer(db, id);
    if (c && payment === 'CREDIT' && Number(creditDays) === 0) setCreditDays(String(c.creditDays));
    // Sin permiso para editar precios, al cambiar de cliente se re-resuelven con su lista de precios.
    if (!settings.allowPriceEdit) {
      const l = priceListFor(db, id);
      setLines((cur) => cur.map((x) => ({ ...x, unitPrice: priceOf(db, x.productId, l?.id ?? null, today) ?? x.unitPrice })));
    }
    dirty.current = true;
  }, [payment, creditDays, settings.allowPriceEdit, today]);

  // al volver de los selectores (cliente / producto) o llegar con un producto/cliente preseleccionado
  const started = useRef(false);
  useFocusEffect(useCallback(() => {
    const c = consumePick('customer'); if (c) changeCustomer(c);
    const p = consumePick('product'); if (p) addProduct(p);
    if (!started.current) {
      started.current = true;
      if (params.addProductId) addProduct(params.addProductId);
      if (params.customerId && !initial) changeCustomer(params.customerId);
    }
  }, [addProduct, changeCustomer, params.addProductId, params.customerId, initial]));

  const readOnly = initial ? !initial.editable : false;
  if (readOnly) return <Screen><Muted>Este documento ya se envió y es de solo lectura.</Muted><Button title="Ver documento" onPress={() => router.replace({ pathname: '/document/[id]', params: { id: initial!.doc.id } })} /></Screen>;

  function saveAndExit() { dirty.current = true; const id = save(); void id; router.back(); }
  function send() {
    setError(null);
    if (validation.errors.length) return;
    try {
      dirty.current = true;
      const id = save() ?? saveDraft(db, input);
      submitDocument(db, id!);
      dirty.current = false;
      session.refreshQueue();
      session.requestSync(); // se envía solo cuando haya conexión
      router.replace({ pathname: '/document/[id]', params: { id: id! } });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar.'); }
  }

  const line = editing !== null ? lines[editing] : null;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: initial?.displayNumber && initial.displayNumber !== '(borrador)' ? initial.displayNumber : 'Nueva cotización' }} />
      <Pressable style={s.card} onPress={() => router.push('/document/pick-customer')} accessibilityRole="button" accessibilityLabel="Elegir cliente">
        <Text style={s.label}>Cliente</Text>
        <Text style={s.value}>{customer?.legalName ?? 'Toque para elegir un cliente'}</Text>
        {customer && <Muted>{customer.rif}{customer.availableCredit !== null ? ` · crédito disponible ${formatMoney(customer.availableCredit, { symbol: 'Bs', decimals: 2 })}` : ''}</Muted>}
      </Pressable>

      <View style={s.rowBetween}>
        <Text style={s.section}>Productos ({lines.length})</Text>
        <Button title="Agregar" kind="secondary" onPress={() => router.push('/document/pick-product')} />
      </View>
      {lines.length === 0 && <Muted>Agregue productos con el buscador o el escáner.</Muted>}
      {lines.map((l, i) => {
        const t = totals.lines[i];
        return (
          <Pressable key={`${l.productId}`} style={s.line} onPress={() => setEditing(i)} accessibilityRole="button" accessibilityLabel={`Editar ${l.sku}`}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{l.sku}</Text>
              <Text style={{ color: colors.muted }} numberOfLines={2}>{l.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{formatQty(l.quantity)} × {formatMoney(l.unitPrice, currency)}{Number(l.discountPct) ? ` · desc. ${formatNumber(l.discountPct, 2)} %` : ''}{Number(l.taxRate) ? '' : ' · exento'}</Text>
            </View>
            <Text style={{ fontWeight: '600', color: colors.text }}>{formatMoney(t.net, currency)}</Text>
          </Pressable>
        );
      })}

      <Text style={s.section}>Condiciones</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={payment === 'CASH' ? '● Contado' : 'Contado'} kind={payment === 'CASH' ? 'primary' : 'secondary'} onPress={() => { setPayment('CASH'); touch(); }} />
        <Button title={payment === 'CREDIT' ? '● Crédito' : 'Crédito'} kind={payment === 'CREDIT' ? 'primary' : 'secondary'} onPress={() => { setPayment('CREDIT'); if (Number(creditDays) === 0 && customer) setCreditDays(String(customer.creditDays)); touch(); }} />
      </View>
      {payment === 'CREDIT' && <Field label="Días de crédito" keyboardType="number-pad" value={creditDays} onChangeText={(v) => { setCreditDays(v.replace(/\D/g, '').slice(0, 3)); touch(); }} />}
      <Field label="Válida hasta (AAAA-MM-DD)" value={validUntil} onChangeText={(v) => { setValidUntil(v); touch(); }} placeholder="2026-12-31" />
      <Field label="Observaciones (opcional)" value={notes} onChangeText={(v) => { setNotes(v); touch(); }} multiline />

      <View style={s.totals}>
        <TotalLine k="Subtotal" v={formatMoney(totals.subtotal, currency)} />
        {totals.byRate.map((g) => <TotalLine key={g.taxRate} k={`IVA ${formatNumber(g.taxRate, 0)} %`} v={formatMoney(g.tax, currency)} />)}
        <TotalLine k={`TOTAL ${currency?.code ?? ''}`} v={formatMoney(totals.total, currency)} bold />
        {totalBs && rate && <Muted>≈ Bs {formatNumber(totalBs, 2)} · tasa {formatNumber(rate.rate, 2)} ({rate.date})</Muted>}
      </View>

      {validation.errors.map((m) => <ErrorText key={m}>{m}</ErrorText>)}
      {validation.warnings.map((m) => <Banner key={m}>{m}</Banner>)}
      <ErrorText>{error}</ErrorText>
      <Button title="Guardar borrador" kind="secondary" onPress={saveAndExit} />
      <Button title="Guardar y enviar" disabled={validation.errors.length > 0} onPress={send} />
      <Muted>El precio, los impuestos y el número definitivo los confirma el servidor al sincronizar.</Muted>

      <LineModal line={line} currency={currency} canEditPrice={settings.allowPriceEdit} maxDiscount={settings.maxDiscountPct} onClose={() => setEditing(null)}
        onChange={(patch) => { setLines((cur) => cur.map((l, k) => (k === editing ? { ...l, ...patch } : l))); touch(); }}
        onRemove={() => { setLines((cur) => cur.filter((_, k) => k !== editing)); setEditing(null); touch(); }} />
    </Screen>
  );
}

function TotalLine({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <View style={s.rowBetween}><Text style={{ color: colors.text, fontWeight: bold ? '700' : '400', fontSize: bold ? 18 : 14 }}>{k}</Text><Text style={{ color: colors.text, fontWeight: bold ? '700' : '600', fontSize: bold ? 18 : 14 }}>{v}</Text></View>;
}

function LineModal({ line, currency, canEditPrice, maxDiscount, onChange, onRemove, onClose }: {
  line: EditorLine | null; currency: ReturnType<typeof currencyOf>; canEditPrice: boolean; maxDiscount: number;
  onChange: (p: Partial<EditorLine>) => void; onRemove: () => void; onClose: () => void;
}) {
  if (!line) return null;
  const dec = (v: string) => v.replace(',', '.').replace(/[^0-9.]/g, '');
  const step = (d: number) => onChange({ quantity: String(Math.max(0, Number(line.quantity || 0) + d)) });
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.section}>{line.sku} · {line.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Button title="−" kind="secondary" onPress={() => step(-1)} />
            <View style={{ flex: 1 }}><Field label="Cantidad" keyboardType="decimal-pad" value={line.quantity} onChangeText={(v) => onChange({ quantity: dec(v) })} /></View>
            <Button title="+" kind="secondary" onPress={() => step(1)} />
          </View>
          <Field label={`Descuento % (máx. ${maxDiscount} %)`} keyboardType="decimal-pad" value={line.discountPct} onChangeText={(v) => onChange({ discountPct: dec(v) })} />
          {canEditPrice
            ? <Field label={`Precio unitario (${currency?.symbol ?? ''})`} keyboardType="decimal-pad" value={line.unitPrice} onChangeText={(v) => onChange({ unitPrice: dec(v) })} />
            : <Muted>Precio de lista: {formatMoney(line.unitPrice, currency)} (no editable)</Muted>}
          <Button title="Listo" onPress={onClose} />
          <Button title="Quitar línea" kind="danger" onPress={onRemove} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 2 },
  label: { color: colors.muted, fontSize: 12 },
  value: { color: colors.text, fontWeight: '700', fontSize: 16 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  totals: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { backgroundColor: '#fff', padding: 16, gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
void TextInput;
