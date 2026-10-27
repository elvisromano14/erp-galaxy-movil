import { useMemo, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

// Componentes base mínimos (M1). La biblioteca de UI definitiva se decide con las pantallas de negocio (decisión #13).
/** Tema oscuro fijo (la app siempre se ve oscura). `bg` fondo de pantalla, `card` tarjetas/hojas, `onPrimary` texto sobre el color primario. */
export const colors = {
  bg: '#0c111d', card: '#161b26', primary: '#2e90fa', primaryBg: '#175cd3', errorBg: '#b42318', onPrimary: '#ffffff', text: '#f5f5f6', muted: '#94969c', border: '#333741',
  error: '#f97066', ok: '#47cd89', warnBg: '#2a1f0a', warn: '#fdb022',
};

export type IconName = keyof typeof Ionicons.glyphMap;

/** Ícono por omisión según el texto del botón (así ningún botón queda sin ícono); se puede forzar con la prop `icon`. */
const ICON_RULES: [RegExp, IconName][] = [
  [/sincroniz|reintentar|continuar la descarga/i, 'sync-outline'], [/cola/i, 'list-outline'], [/bloquear/i, 'lock-closed-outline'], [/cerrar sesi/i, 'log-out-outline'],
  [/diagn/i, 'pulse-outline'], [/restablecer/i, 'refresh-outline'], [/escanear|c[áa]mara/i, 'scan-outline'], [/escribir/i, 'create-outline'], [/buscar/i, 'search-outline'],
  [/huella/i, 'finger-print-outline'], [/entrar/i, 'log-in-outline'], [/cancelar/i, 'close-outline'], [/eliminar|quitar/i, 'trash-outline'], [/duplicar/i, 'copy-outline'],
  [/pdf|compartir/i, 'share-outline'], [/guardar/i, 'save-outline'], [/nuev[oa]/i, 'add-circle-outline'], [/convertir/i, 'swap-horizontal-outline'],
  [/corregir|editar/i, 'create-outline'], [/existencia/i, 'cube-outline'], [/ver |abrir|origen|generado/i, 'open-outline'], [/agregar/i, 'add-outline'], [/listo|continuar/i, 'checkmark-outline'],
];
const iconFor = (title: string): IconName | undefined => ICON_RULES.find(([re]) => re.test(title))?.[1];

export const Icon = ({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const body = <View style={s.screen}>{children}</View>;
  return scroll ? <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body;
}

export const Title = ({ children }: { children: ReactNode }) => <Text style={s.title}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={s.muted}>{children}</Text>;
export const ErrorText = ({ children }: { children?: string | null }) => (children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null);

export function Button({ title, onPress, disabled, kind = 'primary', icon }: { title: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'danger'; icon?: IconName | false }) {
  const name = icon === false ? undefined : (icon ?? iconFor(title));
  const fg = kind === 'secondary' ? colors.primary : colors.onPrimary;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[s.btn, kind === 'secondary' && s.btnSecondary, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.5 }]}>
      {name && <Ionicons name={name} size={20} color={fg} />}
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

/** Tarjeta con borde (paneles del inicio, datos agrupados). */
export const Card = ({ children }: { children: ReactNode }) => <View style={s.card}>{children}</View>;

export const Field = (p: TextInputProps & { label: string }) => (
  <View style={{ gap: 4 }}>
    <Text style={s.label}>{p.label}</Text>
    <TextInput {...p} accessibilityLabel={p.label} placeholderTextColor={colors.muted} keyboardAppearance="dark" style={[s.input, p.style]} />
  </View>
);

export interface SelectOption { id: string; label: string }

/**
 * Selector de lista (unidad, categoría, ubicación…): botón con el valor actual y una hoja con búsqueda. `onChange(null)` = sin selección
 * (solo si `allowEmpty`). Sin dependencias nativas nuevas: usa `Modal` de React Native.
 */
export function Select({ label, value, options, onChange, allowEmpty = false, emptyLabel = 'Ninguna', placeholder = 'Seleccionar…', disabled }: {
  label: string; value: string | null; options: SelectOption[]; onChange: (id: string | null) => void; allowEmpty?: boolean; emptyLabel?: string; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.id === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
  }, [options, q]);
  const close = () => { setOpen(false); setQ(''); };
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? 'sin seleccionar'}`} style={[s.input, s.select, disabled && { opacity: 0.5 }]}>
        <Text style={{ color: current ? colors.text : colors.muted, fontSize: 16, flex: 1 }} numberOfLines={1}>{current?.label ?? (allowEmpty ? emptyLabel : placeholder)}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={s.sheetBack}>
          <View style={s.sheet}>
            <Text style={[s.label, { fontSize: 16 }]}>{label}</Text>
            {options.length > 8 && <TextInput value={q} onChangeText={setQ} placeholder="Buscar…" placeholderTextColor={colors.muted} keyboardAppearance="dark" autoCapitalize="none" style={s.input} accessibilityLabel={`Buscar en ${label}`} />}
            <FlatList
              data={allowEmpty ? [{ id: '', label: emptyLabel }, ...shown] : shown}
              keyExtractor={(o) => o.id || '__none'}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={s.muted}>Sin opciones.</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => { onChange(item.id || null); close(); }} style={s.option} accessibilityRole="button">
                  <Text style={{ color: item.id === (value ?? '') ? colors.primary : colors.text, fontSize: 16, flex: 1 }}>{item.label}</Text>
                  {item.id === (value ?? '') && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </Pressable>
              )}
            />
            <Button title="Cancelar" kind="secondary" onPress={close} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

export const Busy = ({ show }: { show: boolean }) => (show ? <ActivityIndicator accessibilityLabel="Cargando" color={colors.primary} /> : null);

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warn' | 'error' | 'ok' }) {
  const c = { muted: colors.muted, warn: colors.warn, error: colors.error, ok: colors.ok }[tone];
  return <View style={{ borderWidth: 1, borderColor: c, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: c, fontSize: 11, fontWeight: '600' }}>{text}</Text></View>;
}

export const Banner = ({ children }: { children: ReactNode }) => <View style={s.banner}><Text style={{ color: colors.warn }}>{children}</Text></View>;

const s = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 14, justifyContent: 'center', backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 6 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.error },
  label: { color: colors.text, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text, backgroundColor: colors.card },
  btn: { backgroundColor: colors.primaryBg, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnDanger: { backgroundColor: colors.errorBg },
  btnText: { fontWeight: '600', fontSize: 16 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetBack: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10, maxHeight: '80%' },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  banner: { backgroundColor: colors.warnBg, borderRadius: 8, padding: 12 },
});
