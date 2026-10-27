import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { caracasToday } from '../../core/format';
import { db, session } from '../../core/services';
import {
  createProductLocal, defaultsForNew, getProductForEdit, listCategories, listLocations, listTaxes, listUnits, ProductError, updateProductLocal,
} from '../../db/repositories/productEdit';
import { defaultCurrency } from '../../db/repositories/products';
import { explainError } from '../../features/documents/explain';
import { consumePick } from '../../features/documents/pickerStore';
import { Banner, Button, colors, ErrorText, Field, Icon, Muted, Screen, Select } from '../../ui/kit';

/**
 * Alta y edición de productos (sin conexión): se valida con las reglas del servidor, el producto queda usable de inmediato y se encola
 * `product.create` / `product.update`. Marca y ubicación son opcionales y no se exigen.
 */
export default function ProductForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const today = caracasToday();
  const editing = useMemo(() => (id ? getProductForEdit(db, id, today) : null), [id, today]);
  const defaults = useMemo(() => defaultsForNew(db, today), [today]);
  const units = useMemo(() => listUnits(db), []);
  const categories = useMemo(() => listCategories(db), []);
  const locations = useMemo(() => listLocations(db), []);
  const taxes = useMemo(() => listTaxes(db, today), [today]);
  const currency = useMemo(() => defaultCurrency(db), []);

  const [sku, setSku] = useState(editing?.sku ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [unitId, setUnitId] = useState<string | null>(editing ? editing.unitId : defaults.unitId);
  const [taxId, setTaxId] = useState<string | null>(editing ? editing.taxId : defaults.taxId);
  const [brand, setBrand] = useState(editing?.brand ?? '');
  const [locationId, setLocationId] = useState<string | null>(editing?.locationId ?? null);
  const [minStock, setMinStock] = useState(editing?.minStock ?? '');
  const [maxStock, setMaxStock] = useState(editing?.maxStock ?? '');
  const [isService, setIsService] = useState(editing?.isService ?? false);
  const [barcodes, setBarcodes] = useState<string[]>(editing?.barcodes ?? []);
  const [newCode, setNewCode] = useState('');
  const [price, setPrice] = useState(editing?.price ?? '');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  // Código leído con la cámara (pantalla /scan?capture=1): se agrega a la lista al volver.
  useFocusEffect(useCallback(() => {
    const code = consumePick('barcode');
    if (code) setBarcodes((b) => (b.includes(code) ? b : [...b, code]));
  }, []));

  const addCode = () => {
    const c = newCode.trim();
    if (c) setBarcodes((b) => (b.includes(c) ? b : [...b, c]));
    setNewCode('');
  };
  const failed = editing?.lastOp?.status === 'REJECTED';
  const valid = (editing || sku.trim().length > 0) && name.trim().length > 0 && !!unitId;

  function save() {
    setError(null); setExisting(null);
    const input = { name, description, categoryId, unitId: unitId ?? '', taxId, brand, locationId, minStock, maxStock, isService, barcodes: newCode.trim() ? [...barcodes, newCode.trim()] : barcodes, price };
    try {
      const row = editing ? updateProductLocal(db, editing.id, input, { today }) : createProductLocal(db, { sku, ...input }, { today });
      session.refreshQueue();
      session.requestSync(); // se envía solo cuando haya conexión
      if (editing) router.back(); else router.replace({ pathname: '/product/[id]', params: { id: row.id } });
    } catch (e) {
      if (e instanceof ProductError) { setError(e.message); if (e.code === 'DUPLICATE_SKU' || e.code === 'DUPLICATE_BARCODE') setExisting(e.existingId ?? null); } else setError('No se pudo guardar el producto.');
    }
  }

  if (id && !editing) return <Screen><Muted>El producto ya no está en este teléfono.</Muted></Screen>;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: editing ? 'Editar producto' : 'Nuevo producto' }} />
      {failed && <Banner>El servidor rechazó el último envío: {explainError(editing?.lastOp?.lastError)} Corrija y guarde para reenviar.</Banner>}
      <Field label="Código (SKU)" value={sku} onChangeText={setSku} autoCapitalize="characters" autoCorrect={false} editable={!editing} maxLength={60} placeholder="PAS-001" />
      <Field label="Nombre" value={name} onChangeText={setName} maxLength={250} />
      <Field label="Descripción (opcional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />
      <Select label="Unidad" value={unitId} options={units} onChange={setUnitId} placeholder="Elija la unidad" />
      <Select label="Categoría (opcional)" value={categoryId} options={categories} onChange={setCategoryId} allowEmpty emptyLabel="Sin categoría" />
      <Select label="Impuesto" value={taxId} options={taxes} onChange={setTaxId} allowEmpty emptyLabel="Sin impuesto" />
      <Field label="Marca (opcional)" value={brand} onChangeText={setBrand} maxLength={80} autoCapitalize="characters" />
      <Select label="Ubicación (opcional)" value={locationId} options={locations} onChange={setLocationId} allowEmpty emptyLabel="Sin ubicación" />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field label="Mínimo (opcional)" value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Máximo (opcional)" value={maxStock} onChangeText={setMaxStock} keyboardType="decimal-pad" /></View>
      </View>
      <Field label={`Precio${currency ? ` (${currency.symbol}, sin impuesto)` : ''} (opcional)`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Es un servicio (sin existencias)</Text>
        <Switch value={isService} onValueChange={setIsService} accessibilityLabel="Es un servicio" />
      </View>

      <Text style={{ color: colors.text, fontWeight: '600' }}>Códigos de barras (opcional)</Text>
      {barcodes.map((b) => (
        <View key={b} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 }}>
          <Text style={{ color: colors.text }}>{b}</Text>
          <Pressable onPress={() => setBarcodes((x) => x.filter((c) => c !== b))} accessibilityRole="button" accessibilityLabel={`Quitar ${b}`} hitSlop={10}><Icon name="trash-outline" color={colors.error} /></Pressable>
        </View>
      ))}
      <Field label="Agregar código" value={newCode} onChangeText={setNewCode} autoCapitalize="none" autoCorrect={false} onSubmitEditing={addCode} returnKeyType="done" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Agregar código" kind="secondary" disabled={!newCode.trim()} onPress={addCode} /></View>
        <View style={{ flex: 1 }}><Button title="Escanear" kind="secondary" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} /></View>
      </View>

      <ErrorText>{error}</ErrorText>
      {existing && <Button title="Ver el producto existente" kind="secondary" onPress={() => router.replace({ pathname: '/product/[id]', params: { id: existing } })} />}
      <Button title="Guardar" disabled={!valid} onPress={save} />
      <Muted>Queda disponible de inmediato en este teléfono y se envía automáticamente al ERP cuando haya conexión.</Muted>
    </Screen>
  );
}
