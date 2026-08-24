import { Tabs, Redirect } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { allTabNames, isTabVisible, tabsForRole } from '@/lib/navigation';
import { colors } from '@/lib/theme';

const TAB_TITLES: Record<string, string> = {
  index: 'Inicio',
  events: 'Eventos',
  tickets: 'Boletos',
  taquilla: 'Taquilla',
  scan: 'Escanear',
  sales: 'Ventas',
  orders: 'Pedidos',
  platform: 'Plataforma',
  profile: 'Perfil',
};

export default function TabsLayout() {
  const { session, ready } = useAuth();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session?.token) {
    return <Redirect href="/(auth)/login" />;
  }

  const role = session.role;
  const visibleTabs = tabsForRole(role);
  const iconByName = Object.fromEntries(visibleTabs.map((t) => [t.name, t.icon]));

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      {allTabNames().map((name) => {
        const visible = isTabVisible(role, name);
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: TAB_TITLES[name] ?? name,
              href: visible ? undefined : null,
              tabBarIcon: ({ color, size }) => (
                <Ionicons
                  name={(iconByName[name] ?? 'ellipse-outline') as keyof typeof Ionicons.glyphMap}
                  size={size}
                  color={color}
                />
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
