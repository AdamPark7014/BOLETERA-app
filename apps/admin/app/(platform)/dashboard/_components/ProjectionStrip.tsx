'use client';

import { Card } from '@boletera/ui';
import type { ExecutiveSummaryMetrics } from '@boletera/shared';
import { formatCount, formatMxn, formatPercentPoints } from '../format';
import styles from '../dashboard.module.scss';

type ProjectionStripProps = {
  projection: ExecutiveSummaryMetrics['projection'] | undefined;
};

/** Banda de proyección lineal del periodo (ingresos y boletos). */
export function ProjectionStrip({ projection }: ProjectionStripProps) {
  if (!projection) return null;

  const pace =
    projection.daysInPeriod > 0
      ? (projection.daysElapsed / projection.daysInPeriod) * 100
      : 0;

  return (
    <Card className={styles.projection} padding="sm" variant="outline">
      <div className={styles.projectionInner}>
        <div>
          <span className={styles.projLabel}>Proyección del periodo</span>
          <strong>{formatMxn(projection.projectedGrossRevenue)}</strong>
          <span className={styles.projHint}>
            Ritmo lineal · día {projection.daysElapsed} de {projection.daysInPeriod}
          </span>
        </div>
        <div>
          <span className={styles.projLabel}>Boletos proyectados</span>
          <strong>{formatCount(projection.projectedTicketsSold)}</strong>
          <span className={styles.projHint}>Método {projection.method.replace('_', ' ')}</span>
        </div>
        <div className={styles.projProgress} aria-hidden="true">
          <span className={styles.projLabel}>Avance del periodo</span>
          <div className={styles.projBar}>
            <span style={{ width: `${Math.min(100, Math.max(0, pace))}%` }} />
          </div>
          <span className={styles.projHint}>{formatPercentPoints(pace)} del rango</span>
        </div>
      </div>
    </Card>
  );
}
