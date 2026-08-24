import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/lib/auth-context';
import { getPlatformOverview, type PlatformOverview } from '@/lib/api';
import { colors, radii, spacing } from '@/lib/theme';

export default function PlatformTab() {
  const { session } = useAuth();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!session?.token) return;
    try {
      setData(await getPlatformOverview(session.token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sin acceso');
      setData(null);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [session?.token]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      <Screen safe={false} padded={false}>
        <Text style={styles.title}>Control de plataforma</Text>
        <Text style={styles.sub}>SUPER_ADMIN · GET /platform/super/overview</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {data ? (
          <View style={styles.grid}>
            <Tile label="Organizaciones" value={String(data.totals.organizations)} />
            <Tile label="Eventos" value={String(data.totals.events)} />
            <Tile label="Usuarios" value={String(data.totals.users)} />
            <Tile label="Órdenes hoy" value={String(data.health.ordersToday)} />
            <Tile label="Pagos fallidos" value={String(data.health.failedPayments)} />
            <Tile label="Reembolsos pend." value={String(data.health.pendingRefunds)} />
          </View>
        ) : null}

        <Text style={styles.hint}>
          Deep link nexara:// abre esta app nativa. Rutas web admin siguen en el panel desktop.
        </Text>
      </Screen>
    </ScrollView>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, marginBottom: spacing.lg },
  error: { color: colors.error, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '47%',
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileLabel: { color: colors.textMuted, fontSize: 12 },
  tileValue: { color: colors.accent, fontSize: 22, fontWeight: '800', marginTop: 4 },
  hint: { marginTop: spacing.xl, color: colors.textSecondary, lineHeight: 20, fontSize: 13 },
});
