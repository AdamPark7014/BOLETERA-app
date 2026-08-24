import { View, type ViewProps, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/lib/theme';

type ScreenProps = ViewProps & {
  padded?: boolean;
  safe?: boolean;
};

export function Screen({ children, padded = true, safe = true, style, ...rest }: ScreenProps) {
  const content = (
    <View style={[styles.inner, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );

  if (safe) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {content}
      </SafeAreaView>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  padded: {
    padding: spacing.md,
  },
});
