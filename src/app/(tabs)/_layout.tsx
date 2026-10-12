import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../ui/kit';
import { MENU, MenuButton, SideMenu } from '../../ui/sideMenu';

/**
 * Módulos principales con menú lateral (hamburguesa): Inicio, Productos, Existencias, Clientes, Ventas y Más.
 * Se usan `Tabs` sin barra inferior solo para conservar el estado de cada módulo; el menú lo dibuja `SideMenu`.
 */
export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        tabBar={() => null}
        screenOptions={{
          headerShown: true, headerLeft: () => <MenuButton />,
          headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        {MENU.map((m) => <Tabs.Screen key={m.key} name={m.key} options={{ title: m.title }} />)}
      </Tabs>
      <SideMenu />
    </View>
  );
}
