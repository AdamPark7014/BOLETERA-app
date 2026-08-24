import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/navigation';
import { Screen } from '@/components/Screen';
import { colors, radii, spacing } from '@/lib/theme';

export default function ProfileTab() {
  const { session, signOut, expiringSoon, timeLeftMs } = useAuth();

  const minsLeft = timeLeftMs != null ? Math.ceil(timeLeftMs / 60_000) : null;

  return (
    <Screen>
      <Text style={styles.title}>Perfil</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Correo</Text>
        <Text style={styles.value}>{session?.email ?? '—'}</Text>
        <Text style={[styles.label, { marginTop: spacing.md }]}>Rol</Text>
        <Text style={styles.value}>{roleLabel(session?.role ?? '')}</Text>
        {session?.organizationId ? (
          <>
            <Text style={[styles.label, { marginTop: spacing.md }]}>Organización</Text>
            <Text style={styles.valueMono}>{session.organizationId}</Text>
          </>
        ) : null}
        {minsLeft != null ? (
          <Text style={[styles.sessionHint, expiringSoon && styles.sessionWarn]}>
            Sesión: ~{minsLeft} min restantes
          </Text>
        ) : null}
      </View>

      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>

      <Text style={styles.footer}>Deep links: nexara://events/:slug</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  value: { color: colors.text, fontSize: 16, marginTop: 4 },
  valueMono: { color: colors.textSecondary, fontSize: 12, marginTop: 4, fontFamily: 'monospace' },
  sessionHint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 13 },
  sessionWarn: { color: colors.warning, fontWeight: '600' },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  buttonText: { color: colors.text, fontWeight: '600' },
  footer: { marginTop: spacing.xl, color: colors.textMuted, fontSize: 11, textAlign: 'center' },
});
