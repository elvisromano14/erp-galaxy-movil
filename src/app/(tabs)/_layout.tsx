import { Tabs } from 'expo-router';
import { colors } from '../../ui/kit';

/** Pestañas principales (plan §9.1). Clientes y Documentos se agregan en M3–M5. */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="products" options={{ title: 'Productos' }} />
      <Tabs.Screen name="customers" options={{ title: 'Clientes' }} />
    </Tabs>
  );
}
