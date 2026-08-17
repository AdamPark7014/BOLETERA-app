'use client';

import { useMemo } from 'react';
import type { SettlementsMetrics } from '@boletera/shared';
import { Badge, type BadgeTone } from '@boletera/ui/src/components/Badge';
import { BarChart } from '@boletera/ui/src/components/BarChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { formatCount, formatMoney, formatTimestamp } from '../_lib/format';
import { humanizeKey, rowsToSeries } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

type PayoutRow = SettlementsMetrics['payouts'][number] & Record<string, unknown>;

function statusTone(status: string): BadgeTone {
  const key = status.toLowerCase();
  if (key.includes('complete') || key.includes('paid')) return 'success';
  if (key.includes('pending') || key.includes('process')) return 'warning';
  if (key.includes('fail') || key.includes('cancel')) return 'danger';
  return 'neutral';
}

export function SettlementsSection({
  data,
  isPending,
  error,
  onRetry,
}: {
  data: SettlementsMetrics | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const byEventSeries = useMemo(
    () => (data ? rowsToSeries(data.byEvent, 'settlement-events', 'Neto', { limit: 10 }) : []),
    [data],
  );

  const payoutRows = useMemo<PayoutRow[]>(
    () => (data?.payouts ?? []).map((payout) => ({ ...payout })),
    [data],
  );

  const columns = useMemo<DataTableColumn<PayoutRow>[]>(
    () => [
      {
        key: 'periodStart',
        header: 'Periodo',
        width: 200,
        sortValue: (row) => row.periodStart,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.cellPrimary}>
              {formatTimestamp(row.periodStart)} – {formatTimestamp(row.periodEnd)}
            </span>
            {row.referenceId ? (
              <span className={styles.cellSecondary}>{row.referenceId}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'grossRevenue',
        header: 'Bruto',
        align: 'right',
        width: 120,
        sortValue: (row) => row.grossRevenue,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.grossRevenue)}</span>
        ),
      },
      {
        key: 'commission',
        header: 'Comisión',
        align: 'right',
        width: 120,
        sortValue: (row) => row.commission,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.commission)}</span>
        ),
      },
      {
        key: 'netAmount',
        header: 'Neto',
        align: 'right',
        width: 120,
        sortValue: (row) => row.netAmount,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.netAmount)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 120,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={statusTone(row.status)} size="sm" dot>
            {humanizeKey(row.status)}
          </Badge>
        ),
      },
      {
        key: 'processedAt',
        header: 'Procesado',
        width: 140,
        sortValue: (row) => row.processedAt ?? '',
        render: (row) =>
          row.processedAt ? formatTimestamp(row.processedAt) : (
            <span className={styles.cellSecondary}>Pendiente</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Liquidaciones"
          description="Ingreso bruto, comisión, neto pagable y estado de payouts."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) =>
            value.summary.grossRevenue === 0 && value.payouts.length === 0
          }
          emptyTitle="Sin liquidaciones"
          emptyDescription="Cuando haya ventas completadas verás el neto pagable y los payouts del periodo."
          skeleton={<PanelSkeleton height={88} lines={0} />}
        >
          {(value) => (
            <dl className={styles.statList}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Ingreso bruto</dt>
                <dd className={styles.statValue}>
                  {formatMoney(value.summary.grossRevenue)}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Reembolsos</dt>
                <dd className={styles.statValue}>{formatMoney(value.summary.refunds)}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Comisión</dt>
                <dd className={styles.statValue}>
                  {formatMoney(value.summary.commission)}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Neto pagable</dt>
                <dd className={styles.statValue}>
                  {formatMoney(value.summary.netPayable)}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Payouts pendientes</dt>
                <dd className={styles.statValue}>
                  {formatCount(value.summary.pendingPayouts)}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Payouts completados</dt>
                <dd className={styles.statValue}>
                  {formatCount(value.summary.completedPayouts)}
                </dd>
              </div>
            </dl>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader title="Neto por evento" as="h2" />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.byEvent.length === 0}
          emptyTitle="Sin desglose por evento"
          emptyDescription="El neto liquidable por evento aparece cuando hay órdenes completadas."
          skeleton={<PanelSkeleton height={220} lines={0} />}
        >
          {() => (
            <BarChart
              label="Neto por evento"
              series={byEventSeries}
              height={240}
              formatValue={formatMoney}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader title="Historial de payouts" as="h2" />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.payouts.length === 0}
          emptyTitle="Sin payouts"
          emptyDescription="Los cortes de liquidación procesados aparecerán en esta tabla."
          skeleton={<PanelSkeleton height={220} lines={0} />}
        >
          {() => (
            <DataTable
              label="Historial de payouts"
              columns={columns}
              data={payoutRows}
              rowKey={(row) => row.id}
              density="compact"
              maxHeight={360}
              defaultSort={{ key: 'periodStart', direction: 'desc' }}
            />
          )}
        </PanelState>
      </Card>
    </div>
  );
}
