'use client';

import type { AiSalesForecastResponse } from '@boletera/shared';
import { AreaChart, Badge } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  formatCount,
  formatGeneratedAt,
  formatInterval,
  formatMxn,
  formatPercentPoints,
  formatRatio,
} from '../_lib/format';
import {
  confidenceLabel,
  confidenceTone,
  sufficiencyLabel,
  sufficiencyTone,
} from '../_lib/labels';
import styles from '../ai.module.scss';
import { PanelEmpty, PanelError, PanelSkeleton, PanelState } from './PanelState';

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
        title="Selecciona un evento"
        description="La predicción de ventas y ocupación requiere un evento concreto. Elige uno en la barra superior."
        hints={['GET /ai/forecast/events/:eventId', 'Intervalos con cobertura explícita']}
      />
    );
  }

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className={styles.srOnly}>Cargando predicción…</span>
        <PanelSkeleton height={180} lines={4} />
      </div>
    );
  }

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

  return (
    <PanelState
      data={query.data}
      isPending={false}
      error={null}
      isEmpty={() => false}
      emptyTitle="Sin predicción"
      emptyDescription="No hay proyección disponible para este evento."
    >
      {(data) => {
        const paceSeries = [
          {
            id: 'pace',
            name: 'Ocupación acumulada observada',
            data: data.observedPace.map((point) => ({
              label: `Día ${point.dayIndex}`,
              value: Number((point.cumulativeOccupancy * 100).toFixed(2)),
            })),
          },
        ];

        return (
          <div className={styles.stackTight}>
            <div className={styles.metaRow}>
              <Badge tone={confidenceTone(data.projectedOccupancyPercent.level)}>
                Confianza {confidenceLabel(data.projectedOccupancyPercent.level)}
              </Badge>
              <Badge
                tone={sufficiencyTone(data.projectedOccupancyPercent.sufficiency)}
                variant="outline"
              >
                {sufficiencyLabel(data.projectedOccupancyPercent.sufficiency)}
              </Badge>
              <span className={styles.muted}>
                {data.daysUntilEvent} días al evento · {formatGeneratedAt(data.generatedAt)}
              </span>
            </div>

            <div className={styles.forecastGrid}>
              <article className={styles.forecastCard}>
                <span>Ocupación actual</span>
                <strong>{formatPercentPoints(data.occupancyPercent)}</strong>
                <small>
                  {formatCount(data.ticketsSold)} / {formatCount(data.totalCapacity)} boletos
                </small>
              </article>
              <article className={styles.forecastCard}>
                <span>Ocupación proyectada</span>
                <strong>
                  {formatInterval(data.projectedOccupancyPercent, 'percent')}
                </strong>
                <small>
                  Cobertura {(data.projectedOccupancyPercent.coverage * 100).toFixed(0)} %
                </small>
              </article>
              <article className={styles.forecastCard}>
                <span>Ingreso bruto proyectado</span>
                <strong>{formatInterval(data.projectedGrossRevenue, 'mxn')}</strong>
                <small>Actual {formatMxn(data.grossRevenue)}</small>
              </article>
              <article className={styles.forecastCard}>
                <span>Boletos proyectados</span>
                <strong>{formatInterval(data.projectedTicketsSold, 'count')}</strong>
                <small>Método {data.method.name}</small>
              </article>
            </div>

            {data.observedPace.length > 1 ? (
              <AreaChart
                label="Curva de sell-through observada"
                series={paceSeries}
                height={220}
                formatValue={(value) => formatRatio(value / 100)}
              />
            ) : (
              <PanelEmpty
                title="Sin curva observada"
                description="Aún no hay puntos de ritmo de venta suficientes para graficar el sell-through."
              />
            )}

            {data.comparables.length > 0 ? (
              <div className={styles.comparables}>
                <h3 className={styles.blockTitle}>Eventos comparables</h3>
                <ul className={styles.comparableList}>
                  {data.comparables.map((item) => (
                    <li key={item.eventId}>
                      <div>
                        <strong>{item.title}</strong>
                        <span className={styles.muted}>
                          {item.category} · similitud {formatRatio(item.similarity)}
                        </span>
                      </div>
                      <div className={styles.comparableStats}>
                        <span>{formatPercentPoints(item.finalOccupancyPercent)}</span>
                        <span>{formatMxn(item.finalGrossRevenue)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className={styles.methodNote}>
              {data.method.rationale} · muestra{' '}
              {formatCount(data.projectedOccupancyPercent.sampleSize)}
            </p>
          </div>
        );
      }}
    </PanelState>
  );
}
