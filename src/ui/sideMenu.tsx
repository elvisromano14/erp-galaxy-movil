import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { useSession } from '../core/session/hooks';
import { colors, Icon, type IconName } from './kit';

/** Estado del menú lateral (abierto/cerrado), compartido entre el botón del encabezado y el panel. */
export const useMenu = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export const MENU: { key: string; title: string; icon: IconName; iconOn: IconName; href: string }[] = [
  { key: 'index', title: 'Inicio', icon: 'home-outline', iconOn: 'home', href: '/' },
  { key: 'products', title: 'Productos', icon: 'pricetags-outline', iconOn: 'pricetags', href: '/products' },
  { key: 'stock', title: 'Existencias', icon: 'cube-outline', iconOn: 'cube', href: '/stock' },
  { key: 'customers', title: 'Clientes', icon: 'people-outline', iconOn: 'people', href: '/customers' },
  { key: 'documents', title: 'Ventas', icon: 'receipt-outline', iconOn: 'receipt', href: '/documents' },
  { key: 'more', title: 'Más', icon: 'ellipsis-horizontal-circle-outline', iconOn: 'ellipsis-horizontal-circle', href: '/more' },
];

/** Botón de hamburguesa para el encabezado de cada módulo. */
export function MenuButton() {
  const setOpen = useMenu((s) => s.setOpen);
  const waiting = useSession((s) => s.queue.pending + s.queue.rejected + s.queue.review);
  return (
    <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Abrir menú" hitSlop={8} style={s.hamburger}>
      <Icon name="menu" size={26} />
      {waiting > 0 && <View style={s.dot} />}
    </Pressable>
  );
}

const WIDTH = Math.min(300, Dimensions.get('window').width * 0.8);

/** Panel lateral con los módulos. Se cierra al tocar fuera, al elegir un módulo o con el botón Atrás. */
export function SideMenu() {
  const open = useMenu((m) => m.open);
  const setOpen = useMenu((m) => m.setOpen);
  const router = useRouter();
  const path = usePathname();
  const profile = useSession((st) => st.profile);
  const online = useSession((st) => st.online);
  const queue = useSession((st) => st.queue);
  const waiting = queue.pending + queue.rejected + queue.review;
  const [x] = useState(() => new Animated.Value(-WIDTH));

  useEffect(() => { if (open) { x.setValue(-WIDTH); Animated.timing(x, { toValue: 0, duration: 180, useNativeDriver: true }).start(); } }, [open, x]);

  const go = (href: string) => { setOpen(false); if (path !== href) router.navigate(href as never); };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
      <View style={s.root}>
        <Animated.View style={[s.panel, { width: WIDTH, transform: [{ translateX: x }] }]}>
          <View style={s.head}>
            <Text style={s.company} numberOfLines={2}>{profile?.company?.tradeName ?? profile?.company?.legalName ?? 'ERP Ventas'}</Text>
            <Text style={s.user} numberOfLines={1}>{profile?.user.fullName}</Text>
            <View style={s.status}><View style={[s.led, { backgroundColor: online ? colors.ok : colors.warn }]} /><Text style={s.user}>{online ? 'En línea' : 'Sin conexión'}</Text></View>
          </View>
          {MENU.map((m) => {
            const active = path === m.href;
            return (
              <Pressable key={m.key} onPress={() => go(m.href)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[s.item, active && s.itemOn]}>
                <Icon name={active ? m.iconOn : m.icon} size={22} color={active ? colors.primary : colors.text} />
                <Text style={[s.itemText, active && { color: colors.primary }]}>{m.title}</Text>
                {m.key === 'more' && waiting > 0 && <View style={s.badge}><Text style={s.badgeText}>{waiting}</Text></View>}
              </Pressable>
            );
          })}
        </Animated.View>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} accessibilityLabel="Cerrar menú" />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: '#000000aa' },
  panel: { backgroundColor: colors.card, paddingTop: 48, borderRightWidth: 1, borderRightColor: colors.border },
  head: { paddingHorizontal: 20, paddingBottom: 18, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 },
  company: { color: colors.text, fontSize: 20, fontWeight: '700' },
  user: { color: colors.muted, fontSize: 13 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  led: { width: 8, height: 8, borderRadius: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 52 },
  itemOn: { backgroundColor: '#2e90fa22' },
  itemText: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  badge: { backgroundColor: colors.warn, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, alignItems: 'center' },
  badgeText: { color: '#000', fontWeight: '700', fontSize: 12 },
  hamburger: { paddingHorizontal: 12, paddingVertical: 8 },
  dot: { position: 'absolute', top: 6, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.warn },
});
