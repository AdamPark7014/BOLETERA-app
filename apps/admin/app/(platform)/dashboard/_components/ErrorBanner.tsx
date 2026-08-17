'use client';

import { Button } from '@boletera/ui';
import styles from '../dashboard.module.scss';

type Failure = { source: string; error: Error };

type ErrorBannerProps = {
  failures: readonly Failure[];
  onRetry: () => void;
};

/** Banner de error parcial: el resto del dashboard sigue visible. */
export function ErrorBanner({ failures, onRetry }: ErrorBannerProps) {
  if (failures.length === 0) return null;

  const sources = failures.map((f) => f.source).join(', ');

  return (
    <div className={styles.errorBanner} role="alert">
      <div>
        <strong>
          {failures.length === 1
            ? `No se pudo cargar: ${sources}`
            : `No se pudieron cargar ${failures.length} bloques`}
        </strong>
        <p>
          {failures.length === 1
            ? failures[0]!.error.message || 'Revisa la conexión o reintenta.'
            : `${sources}. El resto del panel sigue disponible.`}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}
