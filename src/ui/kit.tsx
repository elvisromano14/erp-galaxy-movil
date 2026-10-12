import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

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
  banner: { backgroundColor: colors.warnBg, borderRadius: 8, padding: 12 },
});
