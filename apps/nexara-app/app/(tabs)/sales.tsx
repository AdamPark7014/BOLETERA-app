import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  FlatList,
  RefreshControl,
} from 'react-native';
import { UserRole } from '@boletera/shared';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/lib/auth-context';
import {
  getPromoterDashboard,
  listAdminOrders,
  type OrderRow,
  type PromoterDashboard,
} from '@/lib/api';
import { colors, radii, spacing } from '@/lib/theme';

type Period = 'DAY' | 'WEEK' | 'MONTH';

export default function SalesTab() {
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>('DAY');
  const [dashboard, setDashboard] = useState<PromoterDashboard | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  const load = useCallback(async () => {
    if (!session?.token) return;
    setLoading(true);
    try {
      if (session.role === UserRole.PROMOTER && session.organizationId) {
        const data = await getPromoterDashboard(session.organizationId, session.token, period);
        setDashboard(data);
        setUsedFallback(false);
      } else {
        setUsedFallback(true);
        setOrders(await listAdminOrders(session.token));
      }
    } catch {
      if (session.organizationId) {
        try {
          setOrders(await listAdminOrders(session.token));
          setUsedFallback(true);
        } catch {
          setDashboard(null);
          setOrders([]);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [session, period]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading && !dashboard && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (usedFallback || !dashboard) {
    return (
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Pedidos recientes</Text>
            <Text style={styles.sub}>Resumen por analytics no disponible — listado filtrado por org.</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Sin pedidos</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.orderId}>{item.publicId}</Text>
            <Text style={styles.meta}>
              {item.status} · {new Date(item.createdAt).toLocaleString('es-MX')}
            </Text>
            {item.event?.title ? <Text style={styles.event}>{item.event.title}</Text> : null}
          </View>
        )}
      />
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Ventas · {dashboard.name}</Text>
      <View style={styles.periodRow}>
        {(['DAY', 'WEEK', 'MONTH'] as Period[]).map((p) => (
          <Pressable
            key={p}
            style={[styles.chip, period === p && styles.chipActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.chipText, period === p && styles.chipTextActive]}>
              {p === 'DAY' ? 'Hoy' : p === 'WEEK' ? 'Semana' : 'Mes'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.metrics}>
        <Metric label="Ingresos" value={money(dashboard.metrics.totalRevenue, dashboard.metrics.currency)} />
        <Metric label="Neto" value={money(dashboard.metrics.netRevenue, dashboard.metrics.currency)} />
        <Metric label="Órdenes" value={String(dashboard.metrics.totalOrders)} />
        <Metric label="Boletos" value={String(dashboard.metrics.totalTicketsSold)} />
      </View>

      {dashboard.topEvents.length > 0 ? (
        <>
          <Text style={styles.section}>Top eventos</Text>
          {dashboard.topEvents.slice(0, 5).map((ev) => (
            <View key={ev.eventId} style={styles.card}>
              <Text style={styles.event}>{ev.title}</Text>
              <Text style={styles.meta}>
                {ev.ticketsSold} boletos · {money(ev.revenue, dashboard.metrics.currency)}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: spacing.md, backgroundColor: colors.bg },
  header: { marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  periodRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
  chipText: { color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    width: '47%',
    backgroundColor: colors.bgCard,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: { color: colors.textMuted, fontSize: 12 },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgCard,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  orderId: { color: colors.text, fontWeight: '700', fontFamily: 'monospace' },
  event: { color: colors.text, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
});
