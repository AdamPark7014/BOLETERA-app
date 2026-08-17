'use client';

import {
  Badge,
  EmptyState,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@boletera/ui';
import type { RecommendationBundle, RevenueEstimate } from '../_lib/types';
import styles from '../pricing.module.scss';

type Props = {
  bundle: RecommendationBundle | undefined;
  revenue: RevenueEstimate | undefined;
  revenueLoading: boolean;
  revenueError: Error | null;
};

/**
 * Señales del motor y estimación de ingreso reportada por la API. No inventa
 * proyecciones: si no hay estimación, lo dice.
 */
export function SignalsPanel({ bundle, revenue, revenueLoading, revenueError }: Props) {
  if (!bundle) {
    return (
      <EmptyState
        size="sm"
        illustration="chart"
        title="Sin señales"
        description="Selecciona un evento con recomendaciones para ver ritmo, ocupación y días al evento."
      />
    );
  }

  const { signals } = bundle;
  const occupancyRatio = signals.occupancyPercent / 100;

  return (
    <div className={styles.stack}>
      <div className={styles.cardHead}>
        <div>
          <h3>Señales del evento</h3>
          <p className={styles.muted}>
            Calculadas al generar el paquete · dinámico{' '}
            {bundle.enableDynamic ? 'activado' : 'desactivado'}
          </p>
        </div>
        <Badge tone={bundle.enableDynamic ? 'success' : 'warning'} variant="outline">
          {bundle.enableDynamic ? 'Dinámico ON' : 'Dinámico OFF'}
        </Badge>
      </div>

      <dl className={styles.signalGrid}>
        <div className={styles.signalItem}>
          <dt>Días al evento</dt>
          <dd>{formatNumber(signals.daysUntilEvent, 1)}</dd>
        </div>
        <div className={styles.signalItem}>
          <dt>Ocupación</dt>
          <dd>{formatPercent(occupancyRatio)}</dd>
        </div>
        <div className={styles.signalItem}>
          <dt>Ritmo esperado</dt>
          <dd>{formatPercent(signals.expectedPace)}</dd>
        </div>
        <div className={styles.signalItem}>
          <dt>Ritmo real</dt>
          <dd>{formatPercent(signals.actualPace)}</dd>
        </div>
        <div className={styles.signalItem}>
          <dt>Δ de ritmo</dt>
          <dd
            className={
              signals.paceDelta > 0
                ? styles.deltaUp
                : signals.paceDelta < 0
                  ? styles.deltaDown
                  : styles.deltaHold
            }
          >
            {formatNumber(signals.paceDelta * 100, 1)} pp
          </dd>
        </div>
        <div className={styles.signalItem}>
          <dt>Vendidos / aforo</dt>
          <dd>
            {formatNumber(signals.soldTickets)} / {formatNumber(signals.totalCapacity)}
          </dd>
        </div>
      </dl>

      <div className={styles.cardHead}>
        <div>
          <h3>Estimación de ingreso</h3>
          <p className={styles.muted}>
            GET /pricing/events/:eventId/revenue-estimate · ingreso bruto a precio base
          </p>
        </div>
      </div>

      {revenueLoading ? (
        <EmptyState
          size="sm"
          illustration="chart"
          title="Cargando estimación"
          description="Consultando el ingreso reportado del evento."
        />
      ) : revenueError ? (
        <EmptyState
          size="sm"
          tone="danger"
          illustration="error"
          title="Estimación no disponible"
          description={revenueError.message}
        />
      ) : !revenue ? (
        <EmptyState
          size="sm"
          illustration="inbox"
          title="Sin estimación"
          description="La API no devolvió una estimación de ingreso para este evento."
        />
      ) : (
        <dl className={styles.signalGrid}>
          <div className={styles.signalItem}>
            <dt>Ingreso bruto</dt>
            <dd>{formatCurrency(revenue.grossRevenue, 0)}</dd>
          </div>
          <div className={styles.signalItem}>
            <dt>Comisión</dt>
            <dd>{formatCurrency(revenue.commission, 0)}</dd>
          </div>
          <div className={styles.signalItem}>
            <dt>Ingreso neto</dt>
            <dd>{formatCurrency(revenue.netRevenue, 0)}</dd>
          </div>
          <div className={styles.signalItem}>
            <dt>Ocupación reportada</dt>
            <dd>{revenue.occupancyPercent}%</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
