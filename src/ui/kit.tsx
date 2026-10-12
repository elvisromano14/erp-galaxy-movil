import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

// Componentes base mínimos (M1). La biblioteca de UI definitiva se decide con las pantallas de negocio (decisión #13).
export const colors = { primary: '#175cd3', text: '#101828', muted: '#667085', border: '#d0d5dd', error: '#b42318', ok: '#067647', warnBg: '#fffaeb', warn: '#b54708' };

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const body = <View style={s.screen}>{children}</View>;
  return scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body;
}

export const Title = ({ children }: { children: ReactNode }) => <Text style={s.title}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={s.muted}>{children}</Text>;
export const ErrorText = ({ children }: { children?: string | null }) => (children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null);

export function Button({ title, onPress, disabled, kind = 'primary' }: { title: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[s.btn, kind === 'secondary' && s.btnSecondary, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, kind === 'secondary' && { color: colors.primary }]}>{title}</Text>
    </Pressable>
  );
}

export const Field = (p: TextInputProps & { label: string }) => (
  <View style={{ gap: 4 }}>
    <Text style={s.label}>{p.label}</Text>
    <TextInput {...p} accessibilityLabel={p.label} placeholderTextColor={colors.muted} style={[s.input, p.style]} />
  </View>
);

export const Busy = ({ show }: { show: boolean }) => (show ? <ActivityIndicator accessibilityLabel="Cargando" /> : null);

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warn' | 'error' | 'ok' }) {
  const c = { muted: colors.muted, warn: colors.warn, error: colors.error, ok: colors.ok }[tone];
  return <View style={{ borderWidth: 1, borderColor: c, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: c, fontSize: 11, fontWeight: '600' }}>{text}</Text></View>;
}

export const Banner = ({ children }: { children: ReactNode }) => <View style={s.banner}><Text style={{ color: colors.warn }}>{children}</Text></View>;

const s = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 14, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.error },
  label: { color: colors.text, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text },
  btn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnDanger: { backgroundColor: colors.error },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  banner: { backgroundColor: colors.warnBg, borderRadius: 8, padding: 12 },
});
