import { View, Text, StyleSheet } from 'react-native';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/lib/theme';

export default function TicketsTab() {
  return (
    <Screen>
      <Text style={styles.title}>Mis boletos</Text>
      <Text style={styles.copy}>
        Consulta QR, transferencias y validación en puerta. Disponible para clientes finales.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  copy: { marginTop: spacing.sm, color: colors.textSecondary, lineHeight: 22 },
});
