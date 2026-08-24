import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/lib/auth-context';
import {
  createStaffHold,
  createTaquillaHold,
  getApiBaseUrl,
  listEvents,
  type EventSummary,
} from '@/lib/api';
import { colors, radii, spacing } from '@/lib/theme';

export default function TaquillaTab() {
  const { session } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.token) return;
    listEvents(session.token)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [session?.token]);

  async function onHold() {
    if (!session?.token || !selectedEvent) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    try {
      // Prefer staff hold (no terminal required); falls back to taquilla POS endpoint.
      let data;
      try {
        data = await createStaffHold(session.token, {
          eventId: selectedEvent.id,
          quantity: qty,
          channel: 'TAQUILLA',
        });
      } catch {
        data = await createTaquillaHold(session.token, {
          terminalId: 'nexara-mobile',
          sessionId: `nexara-${session.userId ?? 'staff'}`,
          eventId: selectedEvent.id,
          quantity: qty,
        });
      }
      const ids =
        data.holdIds ??
        data.holds?.map((h) => h.id) ??
        (data.id ? [data.id] : []);
      setResult(ids.length ? `Hold creado: ${ids.join(', ')}` : JSON.stringify(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear hold');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Venta rápida</Text>
        <Text style={styles.sub}>
          Placeholder de taquilla — reserva inventario vía{' '}
          <Text style={styles.mono}>POST /inventory/staff/holds</Text>
        </Text>

        <Text style={styles.section}>Evento</Text>
        {events.length === 0 ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          events.slice(0, 8).map((ev) => (
            <Pressable
              key={ev.id}
              style={[styles.eventRow, selectedEvent?.id === ev.id && styles.eventSelected]}
              onPress={() => setSelectedEvent(ev)}
            >
              <Text style={styles.eventTitle}>{ev.title}</Text>
              <Text style={styles.eventMeta}>{new Date(ev.startsAt).toLocaleDateString('es-MX')}</Text>
            </Pressable>
          ))
        )}

        <Text style={styles.section}>Cantidad (GA)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={quantity}
          onChangeText={setQuantity}
          placeholder="1"
          placeholderTextColor={colors.textMuted}
        />

        <Pressable
          style={[styles.cta, (!selectedEvent || loading) && styles.ctaDisabled]}
          onPress={onHold}
          disabled={!selectedEvent || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>Reservar (hold)</Text>
          )}
        </Pressable>

        {result ? (
          <View style={styles.okBox}>
            <Text style={styles.okText}>{result}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.apiHint}>API: {getApiBaseUrl()}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 20 },
  mono: { fontFamily: 'monospace', color: colors.accent, fontSize: 12 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  eventRow: {
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    marginBottom: spacing.sm,
  },
  eventSelected: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
  eventTitle: { color: colors.text, fontWeight: '600' },
  eventMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    padding: spacing.md,
    borderRadius: radii.sm,
  },
  cta: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#fff', fontWeight: '700' },
  okBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderRadius: radii.sm,
  },
  okText: { color: colors.success },
  errBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: radii.sm,
  },
  errText: { color: colors.error },
  apiHint: { marginTop: spacing.xl, color: colors.textMuted, fontSize: 11 },
});
