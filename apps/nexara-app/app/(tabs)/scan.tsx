import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/lib/auth-context';
import { scanTicket, type ScanResult } from '@/lib/api';
import { colors, radii, spacing } from '@/lib/theme';

export default function ScanTab() {
  const { session } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ payload: string; result: ScanResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  const handlePayload = useCallback(
    async (payload: string) => {
      if (!session?.token || lockRef.current || !payload.trim()) return;
      lockRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await scanTicket(session.token, payload.trim());
        setLast({ payload: payload.trim(), result });
        setScanning(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de escaneo');
      } finally {
        setBusy(false);
        setTimeout(() => {
          lockRef.current = false;
        }, 1500);
      }
    },
    [session?.token],
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Text style={styles.title}>Cámara requerida</Text>
        <Text style={styles.sub}>Necesitamos acceso a la cámara para leer códigos QR en puerta.</Text>
        <Pressable style={styles.cta} onPress={requestPermission}>
          <Text style={styles.ctaText}>Permitir cámara</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      {scanning ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : ({ data }) => handlePayload(data)}
        />
      ) : (
        <View style={styles.resultPane}>
          {last ? (
            <>
              <Text style={[styles.verdict, last.result.valid ? styles.ok : styles.bad]}>
                {last.result.valid ? 'ACCESO OK' : 'RECHAZADO'}
              </Text>
              <Text style={styles.detail}>{last.result.message ?? last.result.status ?? '—'}</Text>
              {last.result.ticket?.holderName ? (
                <Text style={styles.holder}>{last.result.ticket.holderName}</Text>
              ) : null}
            </>
          ) : null}
          <Pressable style={styles.cta} onPress={() => setScanning(true)}>
            <Text style={styles.ctaText}>Escanear otro</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.overlay}>
        <Text style={styles.overlayTitle}>Acceso · QR</Text>
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
        <View style={styles.manualRow}>
          <TextInput
            style={styles.manualInput}
            placeholder="Código manual"
            placeholderTextColor={colors.textMuted}
            value={manual}
            onChangeText={setManual}
          />
          <Pressable style={styles.manualBtn} onPress={() => handlePayload(manual)}>
            <Text style={styles.manualBtnText}>OK</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: 'rgba(12,14,18,0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  overlayTitle: { color: colors.text, fontWeight: '700', marginBottom: spacing.sm },
  manualRow: { flexDirection: 'row', gap: spacing.sm },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    padding: spacing.sm,
    borderRadius: radii.sm,
  },
  manualBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  manualBtnText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 13 },
  resultPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  verdict: { fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  ok: { color: colors.success },
  bad: { color: colors.error },
  detail: { color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  holder: { color: colors.text, fontSize: 18, marginTop: spacing.sm, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { color: colors.textSecondary, marginVertical: spacing.md, lineHeight: 20 },
  cta: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
    marginTop: spacing.md,
    minWidth: 200,
  },
  ctaText: { color: '#fff', fontWeight: '700' },
});
