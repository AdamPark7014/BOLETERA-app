'use client';

import type { AiSalesForecastResponse } from '@boletera/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import {
  formatCount,
  formatGeneratedAt,
  formatInterval,
  formatMxn,
  formatPercentPoints,
  formatRatio,
} from '../_lib/format';
import { confidenceLabel, sufficiencyLabel } from '../_lib/labels';
import { FigureRow, PanelEmpty, PanelError, PanelSkeleton } from './PanelState';

export function ForecastPanel({
  eventId,
  query,
}: {
  eventId: string | null;
  query: UseQueryResult<AiSalesForecastResponse, Error>;
}) {
  if (!eventId) {
    return (
      <PanelEmpty
        title="Elige un evento"
        description="La predicción de ventas y ocupación requiere un evento concreto. Elígelo arriba."
      />
    );
  }
  if (query.isPending) return <PanelSkeleton label="Cargando predicción." />;
  if (query.error) {
    return (
      <PanelError
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const data = query.data;
  if (!data)
    return <PanelEmpty title="Sin predicción" description="No hay proyección para este evento." />;

  return (
    <div className={styles.stack}>
      <p className={styles.tertiary}>
        Confianza {confidenceLabel(data.projectedOccupancyPercent.level)} ·{' '}
        {sufficiencyLabel(data.projectedOccupancyPercent.sufficiency)} · {data.daysUntilEvent} días
        al evento · {formatGeneratedAt(data.generatedAt)}
      </p>
      <div className={styles.rows}>
        <FigureRow
          label="Ocupación actual"
          meta={`${formatCount(data.ticketsSold)} de ${formatCount(data.totalCapacity)} boletos`}
          value={formatPercentPoints(data.occupancyPercent)}
        />
        <FigureRow
          label="Ocupación proyectada"
          meta={`Cobertura ${(data.projectedOccupancyPercent.coverage * 100).toFixed(0)} %`}
          value={formatInterval(data.projectedOccupancyPercent, 'percent')}
        />
        <FigureRow
          label="Ingreso bruto proyectado"
          meta={`Actual ${formatMxn(data.grossRevenue)}`}
          value={formatInterval(data.projectedGrossRevenue, 'mxn')}
        />
        <FigureRow
          label="Boletos proyectados"
          meta={`Método ${data.method.name}`}
          value={formatInterval(data.projectedTicketsSold, 'count')}
        />
      </div>

      <p className={styles.rowTitle}>Ritmo de venta observado</p>
      {data.observedPace.length > 1 ? (
        <ul className={styles.rows} aria-label="Ocupación acumulada observada">
          {data.observedPace.map((point) => (
            <li key={point.dayIndex} className={styles.row}>
              <p className={styles.rowMeta}>Día {point.dayIndex}</p>
              <span />
              <p className={styles.figure}>{formatRatio(point.cumulativeOccupancy)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>Aún no hay puntos de ritmo de venta suficientes.</p>
      )}

      {data.comparables.length > 0 ? (
        <>
          <p className={styles.rowTitle}>Eventos comparables</p>
          <ul className={styles.rows}>
            {data.comparables.map((item) => (
              <li key={item.eventId} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{item.title}</p>
                  <p className={styles.rowMeta}>
                    {item.category} · similitud {formatRatio(item.similarity)}
                  </p>
                </div>
                <p className={styles.figure}>{formatPercentPoints(item.finalOccupancyPercent)}</p>
                <p className={styles.figure}>{formatMxn(item.finalGrossRevenue)}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={styles.tertiary}>
        {data.method.rationale} · muestra {formatCount(data.projectedOccupancyPercent.sampleSize)}
      </p>
    </div>
  );
}
