'use client';

import Link from 'next/link';
import { Badge, EmptyState, ProgressRing } from '@boletera/ui';
import type { EventSalesPaceMetrics } from '@boletera/shared';
import { formatPercentPoints, riskLabel, riskTone } from '../format';
import { paceSummary } from '../_lib/derive';
import { ListSkeleton, Panel, PanelError } from './Panel';
import styles from '../dashboard.module.scss';

type PacePanelProps = {
  data: EventSalesPaceMetrics | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

export function PacePanel({ data, loading, error, onRetry }: PacePanelProps) {
  const summary = paceSummary(data, 6);

  return (
    <Panel
      headingId="pace-heading"
      title="Ritmo de venta"
      description="Ocupación real frente al ritmo esperado"
      actions={
        <Link href="/events" className={styles.textLink}>
          Ver eventos
        </Link>
      }
      footer={
        summary.total > 0 ? (
          <p className={styles.panelMeta}>
            {summary.atRisk > 0
              ? `${summary.atRisk} en riesgo · ${summary.onTrack} en ritmo`
              : `${summary.onTrack} de ${summary.total} en ritmo`}
          </p>
        ) : null
      }
    >
      {loading && !data ? (
        <ListSkeleton rows={4} height={72} />
      ) : error && !data ? (
        <PanelError
          error={error}
          title="No se pudo cargar el ritmo de venta"
          onRetry={onRetry}
        />
      ) : summary.rows.length === 0 ? (
        <EmptyState
          size="sm"
          tone="neutral"
          illustration="chart"
          title="Sin eventos activos"
          description="Cuando publiques eventos, aquí verás si van adelantados o atrasados respecto al ritmo esperado."
          action={
            <Link href="/events/new" className={styles.primaryLink}>
              Crear evento
            </Link>
          }
        />
      ) : (
        <ul className={styles.paceList}>
          {summary.rows.map((row) => {
            const deltaPts = Math.round(row.paceDelta * 1000) / 10;
            const deltaLabel =
              deltaPts === 0
                ? 'En línea'
                : deltaPts > 0
                  ? `+${deltaPts} pp`
                  : `${deltaPts} pp`;
            const tone = riskTone(row.riskLevel);
            const ringTone = tone === 'neutral' ? 'accent' : tone;
            return (
              <li key={row.eventId}>
                <Link href={`/events/${row.eventId}`} className={styles.paceRow}>
                  <ProgressRing
                    value={row.occupancyPercent}
                    max={100}
                    size={44}
                    thickness={5}
                    tone={ringTone}
                    label={`Ocupación de ${row.title}`}
                  >
                    <span className={styles.paceRingValue}>
                      {Math.round(row.occupancyPercent)}
                    </span>
                  </ProgressRing>

                  <div className={styles.paceMain}>
                    <strong>{row.title}</strong>
                    <span>
                      {row.daysUntilEvent < 0
                        ? 'Evento pasado'
                        : row.daysUntilEvent === 0
                          ? 'Hoy'
                          : `${row.daysUntilEvent} d`}
                      {' · '}
                      {formatPercentPoints(row.occupancyPercent)} ocupación
                      {' · '}
                      {deltaLabel} vs. esperado
                    </span>
                    <div className={styles.paceMeter} aria-hidden="true">
                      <span
                        className={styles.paceExpected}
                        style={{ width: `${Math.min(100, row.expectedPace * 100)}%` }}
                      />
                      <span
                        className={styles.paceActual}
                        style={{ width: `${Math.min(100, row.actualPace * 100)}%` }}
                      />
                    </div>
                  </div>

                  <Badge tone={tone} size="sm" variant="soft">
                    {riskLabel(row.riskLevel)}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
