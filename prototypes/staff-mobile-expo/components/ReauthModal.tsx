import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, radii, spacing } from '@/lib/theme';

type Props = {
  email: string;
  expired: boolean;
  onSubmit: (email: string, password: string) => Promise<boolean>;
  onCancel: () => void;
};

export function ReauthOverlay({ email, expired, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    const ok = await onSubmit(email, password);
    if (!ok) setError('No se pudo renovar la sesión');
    setLoading(false);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{expired ? 'Sesión expirada' : 'Renovar sesión'}</Text>
          <Text style={styles.sub}>
            {expired
              ? 'Tu token caducó. Inicia sesión de nuevo para continuar.'
              : 'Tu sesión está por expirar. Confirma tu contraseña.'}
          </Text>
          <Text style={styles.email}>{email}</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="Contraseña"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            autoFocus
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.primary} onPress={handleSubmit} disabled={loading || !password}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Continuar</Text>
            )}
          </Pressable>
          <Pressable style={styles.secondary} onPress={onCancel} disabled={loading}>
            <Text style={styles.secondaryText}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sub: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  email: {
    color: colors.accent,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.sm,
  },
  error: {
    color: colors.error,
    marginBottom: spacing.sm,
  },
  primary: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondary: {
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
