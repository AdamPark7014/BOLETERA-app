'use client';

import {
  Badge,
  Button,
  EmptyState,
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '@boletera/ui';
import { describeHistoryReason } from '../_lib/labels';
import { toAmount, type PriceHistoryEntry } from '../_lib/types';
import styles from '../pricing.module.scss';

type Props = {
  entries: readonly PriceHistoryEntry[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
};

/**
 * Historial real de `DynamicPrice` para la oferta abierta. Las filas pendientes
 * o rechazadas se etiquetan a partir del prefijo de `reason`, sin parsear el
 * JSON embebido (esa explicación vive en la cola de aprobaciones).
 */
export function PriceHistoryPanel({ entries, loading, error, onRetry }: Props) {
  if (loading) {
    return (
      <EmptyState
        size="sm"
        title="Cargando historial"
        description="Consultando GET /pricing/offers/:offerId/history."
        illustration="chart"
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        size="sm"
        tone="danger"
        illustration="error"
        title="No se pudo cargar el historial"
        description={error.message}
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        }
      />
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        size="sm"
        illustration="inbox"
        title="Sin cambios registrados"
        description="Esta oferta aún no tiene filas en DynamicPrice. El historial aparece cuando se aplica o se encola una recomendación."
      />
    );
  }

  return (
    <ul className={styles.historyList} aria-label="Historial de precios">
      {entries.map((entry) => {
        const described = describeHistoryReason(entry.reason);
        return (
          <li key={entry.id} className={styles.historyItem}>
            <div className={styles.historyHead}>
              <span className={styles.amount}>
                {formatCurrency(toAmount(entry.adjustedPrice))}
              </span>
              <Badge tone={described.tone} variant="outline">
                {described.label}
              </Badge>
            </div>
            <p className={styles.muted}>
              ×{formatNumber(entry.priceMultiplier, 2)} · {formatDateTime(entry.createdAt)}
            </p>
            {described.detail ? <p className={styles.recBody}>{described.detail}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
