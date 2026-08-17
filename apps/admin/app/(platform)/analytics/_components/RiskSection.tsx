'use client';

import { useMemo } from 'react';
import type { FraudSignalsMetrics, ResaleMetrics } from '@boletera/shared';
import { Badge, type BadgeTone } from '@boletera/ui/src/components/Badge';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { LineChart } from '@boletera/ui/src/components/LineChart';
import { vizColor } from '@boletera/ui/src/styles/tokens';
import {
  formatCount,
  formatMoney,
  formatTimestamp,
  unitFormatter,
} from '../_lib/format';
import { breakdownToSlices, humanizeKey, timeSeriesToChart } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

type SignalRow = FraudSignalsMetrics['recentSignals'][number] & Record<string, unknown>;

function severityTone(severity: string): BadgeTone {
  const key = severity.toLowerCase();
  if (key === 'critical' || key === 'high') return 'danger';
  if (key === 'medium' || key === 'warning') return 'warning';
  if (key === 'low' || key === 'info') return 'info';
  return 'neutral';
}

export function RiskSection({
  fraud,
  fraudPending,
  fraudError,
  onRetryFraud,
  resale,
  resalePending,
  resaleError,
  onRetryResale,
}: {
  fraud: FraudSignalsMetrics | undefined;
  fraudPending: boolean;
  fraudError: unknown;
  onRetryFraud: () => void;
  resale: ResaleMetrics | undefined;
  resalePending: boolean;
  resaleError: unknown;
  onRetryResale: () => void;
}) {
  const byTypeSlices = useMemo(
    () => (fraud ? breakdownToSlices(fraud.byType) : []),
    [fraud],
  );

  const bySeveritySlices = useMemo(
    () => (fraud ? breakdownToSlices(fraud.bySeverity) : []),
    [fraud],
  );

  const resaleSeries = useMemo(
    () =>
      (resale?.series ?? []).map((series, index) =>
        timeSeriesToChart(series, { color: vizColor(index) }),
      ),
    [resale],
  );

  const signalRows = useMemo<SignalRow[]>(
    () => (fraud?.recentSignals ?? []).map((signal) => ({ ...signal })),
    [fraud],
  );

  const signalColumns = useMemo<DataTableColumn<SignalRow>[]>(
    () => [
      {
        key: 'type',
        header: 'Señal',
        width: 180,
        sortValue: (row) => row.type,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.cellPrimary}>{humanizeKey(row.type)}</span>
            <span className={styles.cellSecondary}>{row.reason}</span>
          </div>
        ),
      },
      {
        key: 'severity',
        header: 'Severidad',
        width: 110,
        sortValue: (row) => row.severity,
        render: (row) => (
          <Badge tone={severityTone(row.severity)} size="sm" dot>
            {humanizeKey(row.severity)}
          </Badge>
        ),
      },
      {
        key: 'score',
        header: 'Score',
        align: 'right',
        width: 90,
        sortValue: (row) => row.score,
        render: (row) => <span className={styles.numeric}>{formatCount(row.score)}</span>,
      },
      {
        key: 'status',
        header: 'Estado',
        width: 110,
        sortValue: (row) => row.status,
        render: (row) => humanizeKey(row.status),
      },
      {
        key: 'createdAt',
        header: 'Detectada',
        width: 140,
        sortValue: (row) => row.createdAt,
        render: (row) => formatTimestamp(row.createdAt),
      },
    ],
    [],
  );

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Antifraude"
          description="Banderas abiertas, severidad y score medio del periodo."
          as="h2"
        />
        <PanelState
          data={fraud}
          isPending={fraudPending}
          error={fraudError}
          onRetry={onRetryFraud}
          isEmpty={(value) => value.summary.totalFlags === 0}
          emptyTitle="Sin señales de fraude"
          emptyDescription="No se detectaron banderas en el periodo. El panel se llenará cuando el motor marque riesgo."
          skeleton={<PanelSkeleton height={88} lines={0} />}
        >
          {(value) => (
            <dl className={styles.statList}>
              {(
                [
                  ['Total', value.summary.totalFlags],
                  ['Abiertas', value.summary.openFlags],
                  ['Críticas', value.summary.criticalFlags],
                  ['Resueltas', value.summary.resolvedFlags],
                  ['Falsos positivos', value.summary.falsePositives],
                  ['Score medio', value.summary.averageRiskScore],
                ] as const
              ).map(([label, amount]) => (
                <div key={label} className={styles.stat}>
                  <dt className={styles.statLabel}>{label}</dt>
                  <dd className={styles.statValue}>{formatCount(amount)}</dd>
                </div>
              ))}
            </dl>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader title="Por tipo" as="h2" />
        <PanelState
          data={fraud}
          isPending={fraudPending}
          error={fraudError}
          onRetry={onRetryFraud}
          isEmpty={(value) => value.byType.rows.length === 0}
          emptyTitle="Sin tipos"
          emptyDescription="Las señales se agrupan por tipo cuando hay volumen."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {(value) => (
            <DonutChart
              label="Señales por tipo"
              slices={byTypeSlices}
              center={formatCount(value.byType.total)}
              centerLabel="Total"
              formatValue={formatCount}
              height={200}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader title="Por severidad" as="h2" />
        <PanelState
          data={fraud}
          isPending={fraudPending}
          error={fraudError}
          onRetry={onRetryFraud}
          isEmpty={(value) => value.bySeverity.rows.length === 0}
          emptyTitle="Sin severidades"
          emptyDescription="El desglose aparece con la primera bandera del periodo."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {(value) => (
            <DonutChart
              label="Señales por severidad"
              slices={bySeveritySlices}
              center={formatCount(value.bySeverity.total)}
              centerLabel="Total"
              formatValue={formatCount}
              height={200}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader title="Señales recientes" as="h2" />
        <PanelState
          data={fraud}
          isPending={fraudPending}
          error={fraudError}
          onRetry={onRetryFraud}
          isEmpty={(value) => value.recentSignals.length === 0}
          emptyTitle="Sin señales recientes"
          emptyDescription="El historial corto de antifraude aparece aquí."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {() => (
            <DataTable
              label="Señales recientes de fraude"
              columns={signalColumns}
              data={signalRows}
              rowKey={(row) => row.id}
              density="compact"
              maxHeight={360}
              defaultSort={{ key: 'createdAt', direction: 'desc' }}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Marketplace de reventa"
          description="GMV, fees y flujo de listados del mercado secundario."
          as="h2"
        />
        <PanelState
          data={resale}
          isPending={resalePending}
          error={resaleError}
          onRetry={onRetryResale}
          isEmpty={(value) =>
            value.summary.activeListings === 0 &&
            value.summary.soldListings === 0 &&
            value.series.every((series) => series.points.length === 0)
          }
          emptyTitle="Sin actividad de reventa"
          emptyDescription="Cuando haya listados en el mercado secundario verás GMV, fees y la serie diaria."
          skeleton={<PanelSkeleton height={200} lines={1} />}
        >
          {(value) => (
            <>
              <dl className={styles.statList}>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Activos</dt>
                  <dd className={styles.statValue}>
                    {formatCount(value.summary.activeListings)}
                  </dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Vendidos</dt>
                  <dd className={styles.statValue}>
                    {formatCount(value.summary.soldListings)}
                  </dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>GMV</dt>
                  <dd className={styles.statValue}>{formatMoney(value.summary.grossGmv)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Fees</dt>
                  <dd className={styles.statValue}>
                    {formatMoney(value.summary.platformFees)}
                  </dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Precio medio venta</dt>
                  <dd className={styles.statValue}>
                    {formatMoney(value.summary.averageSoldPrice)}
                  </dd>
                </div>
              </dl>
              {resaleSeries.length > 0 ? (
                <LineChart
                  label="Serie de reventa"
                  series={resaleSeries}
                  height={220}
                  formatValue={unitFormatter('count')}
                />
              ) : null}
            </>
          )}
        </PanelState>
      </Card>
    </div>
  );
}
