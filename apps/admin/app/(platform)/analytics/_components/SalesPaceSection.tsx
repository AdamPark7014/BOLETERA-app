'use client';

import { useMemo } from 'react';
import type { EventSalesPaceMetrics, EventSalesPaceRow } from '@boletera/shared';
import { Badge, type BadgeTone } from '@boletera/ui/src/components/Badge';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { formatCount, formatMoney, formatPercentPoints, formatRatio } from '../_lib/format';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

type PaceRow = EventSalesPaceRow & Record<string, unknown>;

const RISK_TONE: Record<EventSalesPaceRow['riskLevel'], BadgeTone> = {
  on_track: 'success',
  watch: 'info',
  at_risk: 'warning',
  critical: 'danger',
};

const RISK_LABEL: Record<EventSalesPaceRow['riskLevel'], string> = {
  on_track: 'En curva',
  watch: 'Vigilancia',
  at_risk: 'En riesgo',
  critical: 'Crítico',
};

function PaceMeter({ actual, expected }: { actual: number; expected: number }) {
  const actualPct = Math.max(0, Math.min(100, actual * 100));
  const expectedPct = Math.max(0, Math.min(100, expected * 100));
  const behind = actual + 0.05 < expected;
  return (
    <div className={styles.cellStack} style={{ minWidth: 120 }}>
      <div className={styles.meter} aria-hidden="true">
        <div
          className={`${styles.meterFill} ${behind ? styles.meterWarning : styles.meterSuccess}`}
          style={{ width: `${actualPct}%` }}
        />
      </div>
      <span className={styles.cellSecondary}>
        {formatRatio(actual, 0)} vs {formatRatio(expected, 0)} esp.
        <span className={styles.srOnly}> (marca esperada al {formatPercentPoints(expectedPct, 0)})</span>
      </span>
    </div>
  );
}

export function SalesPaceSection({
  data,
  isPending,
  error,
  onRetry,
}: {
  data: EventSalesPaceMetrics | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const rows = useMemo<PaceRow[]>(
    () => (data?.events ?? []).map((event) => ({ ...event })),
    [data],
  );

  const columns = useMemo<DataTableColumn<PaceRow>[]>(
    () => [
      {
        key: 'title',
        header: 'Evento',
        width: 240,
        sortValue: (row) => row.title,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.cellPrimary}>{row.title}</span>
            <span className={styles.cellSecondary}>
              {formatCount(row.daysUntilEvent)} días · {row.status}
            </span>
          </div>
        ),
      },
      {
        key: 'occupancyPercent',
        header: 'Ocupación',
        align: 'right',
        width: 110,
        sortValue: (row) => row.occupancyPercent,
        render: (row) => (
          <span className={styles.numeric}>{formatPercentPoints(row.occupancyPercent, 0)}</span>
        ),
      },
      {
        key: 'ticketsSold',
        header: 'Vendidos',
        align: 'right',
        width: 130,
        sortValue: (row) => row.ticketsSold,
        render: (row) => (
          <span className={styles.numeric}>
            {formatCount(row.ticketsSold)} / {formatCount(row.totalCapacity)}
          </span>
        ),
      },
      {
        key: 'grossRevenue',
        header: 'Ingreso',
        align: 'right',
        width: 120,
        sortValue: (row) => row.grossRevenue,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.grossRevenue)}</span>
        ),
      },
      {
        key: 'actualPace',
        header: 'Ritmo',
        width: 160,
        sortValue: (row) => row.paceDelta,
        render: (row) => <PaceMeter actual={row.actualPace} expected={row.expectedPace} />,
      },
      {
        key: 'riskLevel',
        header: 'Riesgo',
        width: 120,
        sortValue: (row) => row.riskLevel,
        render: (row) => (
          <Badge tone={RISK_TONE[row.riskLevel]} size="sm" dot>
            {RISK_LABEL[row.riskLevel]}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span4}`} padding="md" variant="outline">
        <CardHeader title="En riesgo" description="Por debajo de la curva esperada." as="h2" />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.atRisk.length === 0}
          emptyTitle="Ningún evento en riesgo"
          emptyDescription="Todos los eventos con venta abierta van en o por encima de su curva esperada."
          skeleton={<PanelSkeleton height={120} lines={2} />}
        >
          {(value) => (
            <ul className={styles.alertList}>
              {value.atRisk.slice(0, 5).map((event) => (
                <li key={event.eventId} className={styles.alert}>
                  <div className={styles.alertHead}>
                    <Badge tone={RISK_TONE[event.riskLevel]} size="sm" dot>
                      {RISK_LABEL[event.riskLevel]}
                    </Badge>
                    <h3 className={styles.alertTitle}>{event.title}</h3>
                  </div>
                  <p className={styles.alertText}>
                    {formatRatio(event.actualPace, 0)} vendido vs {formatRatio(event.expectedPace, 0)}{' '}
                    esperado · {formatCount(event.remainingCapacity)} lugares libres
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span8}`} padding="md" variant="outline">
        <CardHeader
          title="Top performers"
          description="Eventos con mejor ritmo de venta relativo."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.topPerformers.length === 0}
          emptyTitle="Sin líderes todavía"
          emptyDescription="Cuando haya eventos con venta suficiente aparecerán aquí los de mejor ritmo."
          skeleton={<PanelSkeleton height={120} lines={2} />}
        >
          {(value) => (
            <ul className={styles.alertList}>
              {value.topPerformers.slice(0, 5).map((event) => (
                <li key={event.eventId} className={styles.alert}>
                  <div className={styles.alertHead}>
                    <Badge tone="success" size="sm" dot>
                      {formatPercentPoints(event.occupancyPercent, 0)}
                    </Badge>
                    <h3 className={styles.alertTitle}>{event.title}</h3>
                  </div>
                  <p className={styles.alertText}>
                    {formatMoney(event.grossRevenue)} · {formatCount(event.ticketsSold)} boletos
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Ritmo de venta por evento"
          description="Comparación del sell-through real contra la curva lineal esperada."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.events.length === 0}
          emptyTitle="Sin eventos en el alcance"
          emptyDescription="No hay eventos con inventario activo para calcular ritmo de venta."
          skeleton={<PanelSkeleton height={240} lines={0} />}
        >
          {() => (
            <DataTable
              label="Ritmo de venta por evento"
              columns={columns}
              data={rows}
              rowKey={(row) => row.eventId}
              density="compact"
              maxHeight={420}
              defaultSort={{ key: 'actualPace', direction: 'asc' }}
            />
          )}
        </PanelState>
      </Card>
    </div>
  );
}
