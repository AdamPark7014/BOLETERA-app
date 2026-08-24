import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { listEvents, type EventSummary } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors, radii, spacing } from '@/lib/theme';

export default function EventsTab() {
  const { session } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listEvents(session?.token);
      setEvents(data);
    } catch {
      setEvents([]);
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
      data={events}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
      ListEmptyComponent={<Text style={styles.empty}>Sin eventos publicados</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.meta}>
            {new Date(item.startsAt).toLocaleString('es-MX')}
            {item.venue ? ` · ${item.venue.name}` : ''}
          </Text>
          {item.minPrice != null ? (
            <Text style={styles.price}>Desde ${item.minPrice.toLocaleString('es-MX')}</Text>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  list: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.bgCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  title: { fontWeight: '700', fontSize: 16, color: colors.text },
  meta: { marginTop: 4, color: colors.textSecondary, fontSize: 13 },
  price: { marginTop: spacing.sm, color: colors.accent, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
});
