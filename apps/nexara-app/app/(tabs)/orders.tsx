import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { listAdminOrders, type OrderRow } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors, radii, spacing } from '@/lib/theme';

export default function OrdersTab() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.token) return;
    try {
      setOrders(await listAdminOrders(session.token));
    } catch {
      setOrders([]);
    }
  }, [session?.token]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

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
    <FlatList
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
      ListHeaderComponent={<Text style={styles.title}>Pedidos</Text>}
      ListEmptyComponent={<Text style={styles.empty}>Sin pedidos en tu organización</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.publicId}>{item.publicId}</Text>
          <Text style={styles.status}>{item.status}</Text>
          <Text style={styles.meta}>
            {new Date(item.createdAt).toLocaleString('es-MX')}
            {item.buyerEmail ? ` · ${item.buyerEmail}` : ''}
          </Text>
          {item.event?.title ? <Text style={styles.event}>{item.event.title}</Text> : null}
          <Text style={styles.amount}>
            ${Number(item.totalAmount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: spacing.md, backgroundColor: colors.bg },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  publicId: { color: colors.accent, fontWeight: '700', fontFamily: 'monospace' },
  status: { color: colors.text, fontWeight: '600', marginTop: 4 },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  event: { color: colors.text, marginTop: spacing.sm },
  amount: { color: colors.text, fontWeight: '700', marginTop: spacing.sm, fontSize: 16 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
});
