'use client';

import { Badge, Button } from '@boletera/ui';
import { formatMoney, formatSignedMoney } from '../_lib/money';
import { RECONCILIATION_LABEL, RECONCILIATION_TONE } from '../_lib/payouts';
import type { ReconciliationCheck } from '../_lib/types';
import styles from '../payouts.module.scss';

type ReconciliationPanelProps = {
  checks: readonly ReconciliationCheck[];
  periodLabel: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

/** Contraste entre reporte de liquidación, métricas y liquidaciones emitidas. */
export function ReconciliationPanel({
  checks,
  periodLabel,
  loading,
  error,
  onRetry,
}: ReconciliationPanelProps) {
  const failing = checks.filter((entry) => entry.severity === 'error').length;

  return (
    <section className={styles.card} aria-label="Conciliación del periodo">
      <header className={styles.cardHead}>
        <div>
          <h2>Conciliación</h2>
          <p className={styles.muted}>{periodLabel}</p>
        </div>
        {failing > 0 ? (
          <Badge tone="danger" variant="soft" size="sm">
            {failing} descuadre(s)
          </Badge>
        ) : (
          !loading &&
          !error && (
            <Badge tone="success" variant="soft" size="sm">
              Sin descuadres
            </Badge>
          )
        )}
      </header>

      {error ? (
        <div role="alert" className={styles.inlineError}>
          <p>No se pudo cargar el reporte de liquidación del periodo.</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : loading ? (
        <p className={styles.muted} role="status">
          Comparando fuentes…
        </p>
      ) : (
        <ul className={styles.checkList}>
          {checks.map((entry) => (
            <li key={entry.id} className={styles.checkRow}>
              <div className={styles.checkHead}>
                <strong>{entry.label}</strong>
                <Badge tone={RECONCILIATION_TONE[entry.severity]} variant="soft" size="sm" dot>
                  {RECONCILIATION_LABEL[entry.severity]}
                </Badge>
              </div>
              <p className={styles.muted}>{entry.description}</p>
              <dl className={styles.checkAmounts}>
                <div>
                  <dt>{entry.expectedLabel}</dt>
                  <dd>{entry.expectedCents === null ? '—' : formatMoney(entry.expectedCents)}</dd>
                </div>
                <div>
                  <dt>{entry.actualLabel}</dt>
                  <dd>{entry.actualCents === null ? '—' : formatMoney(entry.actualCents)}</dd>
                </div>
                <div>
                  <dt>Diferencia</dt>
                  <dd
                    className={
                      entry.severity === 'error' ? styles.deltaBad : styles.deltaNeutral
                    }
                  >
                    {entry.deltaCents === null ? '—' : formatSignedMoney(entry.deltaCents)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
