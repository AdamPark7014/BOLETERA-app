'use client';

import { useMemo } from 'react';
import type { OrdersPaymentsMetrics } from '@boletera/shared';
import { BarChart } from '@boletera/ui/src/components/BarChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { formatCount, formatMoney } from '../_lib/format';
import { breakdownToSeries, breakdownToSlices } from '../_lib/series';
import styles from '../analytics.module.scss';
import { KpiStrip } from './KpiStrip';
import { PanelState, PanelSkeleton } from './PanelState';

export function OrdersSection({
  data,
  isPending,
  error,
  onRetry,
  comparisonLabel,
}: {
  data: OrdersPaymentsMetrics | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  comparisonLabel: string;
}) {
  const statusSeries = useMemo(
    () => (data ? breakdownToSeries(data.volumeByStatus, 'Órdenes', { limit: 8 }) : []),
    [data],
  );

  const methodSlices = useMemo(
    () => (data ? breakdownToSlices(data.paymentMethodBreakdown) : []),
    [data],
  );

  return (
    <>
      <KpiStrip
        loading={isPending && !data}
        comparisonLabel={comparisonLabel}
        items={
          data
            ? [
                { kpi: data.kpis.grossRevenue, tone: 'accent' },
                { kpi: data.kpis.completedOrders, tone: 'success' },
                { kpi: data.kpis.approvalRate, tone: 'info' },
                {
                  kpi: data.kpis.refundRate,
                  tone: 'warning',
                  invertDelta: true,
                },
                {
                  kpi: data.kpis.chargebackCount,
                  tone: 'danger',
                  invertDelta: true,
                },
              ]
            : []
        }
      />

      <div className={styles.grid}>
        <Card className={`${styles.panel} ${styles.span8}`} padding="md" variant="outline">
          <CardHeader
            title="Volumen por estado"
            description="Distribución de órdenes creadas en el periodo."
            as="h2"
          />
          <PanelState
            data={data}
            isPending={isPending}
            error={error}
            onRetry={onRetry}
            isEmpty={(value) => value.volumeByStatus.rows.length === 0}
            emptyTitle="Sin órdenes"
            emptyDescription="No se registraron órdenes en el rango seleccionado."
            skeleton={<PanelSkeleton height={220} lines={0} />}
          >
            {() => (
              <BarChart
                label="Volumen por estado"
                series={statusSeries}
                height={240}
                formatValue={formatCount}
              />
            )}
          </PanelState>
        </Card>

        <Card className={`${styles.panel} ${styles.span4}`} padding="md" variant="outline">
          <CardHeader title="Métodos de pago" as="h2" />
          <PanelState
            data={data}
            isPending={isPending}
            error={error}
            onRetry={onRetry}
            isEmpty={(value) => value.paymentMethodBreakdown.rows.length === 0}
            emptyTitle="Sin métodos"
            emptyDescription="Cuando haya pagos completados verás la mezcla de métodos aquí."
            skeleton={<PanelSkeleton height={220} lines={0} />}
          >
            {(value) => (
              <DonutChart
                label="Métodos de pago"
                slices={methodSlices}
                center={formatMoney(value.kpis.grossRevenue.value)}
                centerLabel="Ingreso"
                formatValue={formatCount}
                height={220}
              />
            )}
          </PanelState>
        </Card>
      </div>
    </>
  );
}
