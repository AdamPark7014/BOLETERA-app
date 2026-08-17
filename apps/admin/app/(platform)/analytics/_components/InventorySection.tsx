'use client';

import { useMemo } from 'react';
import type { InventoryMetrics, InventoryZoneRow } from '@boletera/shared';
import { Badge } from '@boletera/ui/src/components/Badge';
import { BarChart } from '@boletera/ui/src/components/BarChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { formatCount, formatPercentPoints, unitFormatter } from '../_lib/format';
import { breakdownToSlices } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

type ZoneRow = InventoryZoneRow & Record<string, unknown>;

export function InventorySection({
  data,
  isPending,
  error,
  onRetry,
}: {
  data: InventoryMetrics | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const zoneRows = useMemo<ZoneRow[]>(
    () => (data?.byZone ?? []).map((zone) => ({ ...zone })),
    [data],
  );

  const statusSlices = useMemo(
    () => (data ? breakdownToSlices(data.statusBreakdown) : []),
    [data],
  );

  const velocitySeries = useMemo(() => {
    if (!data) return [];
    const top = [...data.byZone]
      .sort((a, b) => b.sellThroughVelocity - a.sellThroughVelocity)
      .slice(0, 8);
    if (top.length === 0) return [];
    return [
      {
        id: 'velocity',
        name: 'Boletos / día',
        data: top.map((zone) => ({
          label: `${zone.zone}`,
          value: zone.sellThroughVelocity,
        })),
      },
    ];
  }, [data]);

  const columns = useMemo<DataTableColumn<ZoneRow>[]>(
    () => [
      {
        key: 'eventTitle',
        header: 'Oferta',
        width: 220,
        sortValue: (row) => row.eventTitle,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.cellPrimary}>
              {row.zone} · {row.tierName}
            </span>
            <span className={styles.cellSecondary}>{row.eventTitle}</span>
          </div>
        ),
      },
      {
        key: 'soldQuantity',
        header: 'Vendidos',
        align: 'right',
        width: 120,
        sortValue: (row) => row.soldQuantity,
        render: (row) => (
          <span className={styles.numeric}>
            {formatCount(row.soldQuantity)} / {formatCount(row.totalQuantity)}
          </span>
        ),
      },
      {
        key: 'availabilityPercent',
        header: 'Disponible',
        align: 'right',
        width: 110,
        sortValue: (row) => row.availabilityPercent,
        render: (row) => {
          const tight = row.availabilityPercent < 15;
          return (
            <Badge tone={tight ? 'warning' : 'neutral'} size="sm">
              {formatPercentPoints(row.availabilityPercent, 0)}
            </Badge>
          );
        },
      },
      {
        key: 'holdQuantity',
        header: 'Apartados',
        align: 'right',
        width: 100,
        sortValue: (row) => row.holdQuantity,
        render: (row) => (
          <span className={styles.numeric}>{formatCount(row.holdQuantity)}</span>
        ),
      },
      {
        key: 'sellThroughVelocity',
        header: 'Velocidad',
        align: 'right',
        width: 110,
        sortValue: (row) => row.sellThroughVelocity,
        render: (row) => (
          <span className={styles.numeric}>
            {formatCount(row.sellThroughVelocity)} /día
          </span>
        ),
      },
      {
        key: 'daysToSellOut',
        header: 'Agotamiento',
        align: 'right',
        width: 120,
        sortValue: (row) => row.daysToSellOut ?? Number.POSITIVE_INFINITY,
        render: (row) =>
          row.daysToSellOut === null ? (
            <span className={styles.cellSecondary}>Sin ritmo</span>
          ) : (
            <span className={styles.numeric}>
              ~{formatCount(Math.ceil(row.daysToSellOut))} días
            </span>
          ),
      },
    ],
    [],
  );

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Resumen de inventario"
          description="Capacidad, vendidos, apartados y bloqueados en el alcance."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.summary.totalCapacity === 0}
          emptyTitle="Sin inventario activo"
          emptyDescription="Publica ofertas o elige un evento con aforo para ver disponibilidad."
          skeleton={<PanelSkeleton height={88} lines={0} />}
        >
          {(value) => (
            <dl className={styles.statList}>
              {(
                [
                  ['Capacidad', value.summary.totalCapacity],
                  ['Disponible', value.summary.available],
                  ['Vendidos', value.summary.sold],
                  ['Apartados', value.summary.held],
                  ['Bloqueados', value.summary.blocked],
                  ['Holds activos', value.summary.activeHolds],
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

      <Card className={`${styles.panel} ${styles.span4}`} padding="md" variant="outline">
        <CardHeader title="Estado del inventario" as="h2" />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.statusBreakdown.rows.length === 0}
          emptyTitle="Sin desglose"
          emptyDescription="No hay filas de estado de inventario."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {(value) => (
            <DonutChart
              label="Estado del inventario"
              slices={statusSlices}
              center={formatCount(value.statusBreakdown.total)}
              centerLabel="Total"
              formatValue={formatCount}
              height={200}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span8}`} padding="md" variant="outline">
        <CardHeader
          title="Velocidad de sell-through"
          description="Boletos vendidos por día en las zonas más activas."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={() => velocitySeries.length === 0}
          emptyTitle="Sin velocidad medible"
          emptyDescription="Las zonas necesitan ventas recientes para calcular boletos por día."
          skeleton={<PanelSkeleton height={220} lines={0} />}
        >
          {() => (
            <BarChart
              label="Velocidad de sell-through"
              series={velocitySeries}
              height={220}
              formatValue={unitFormatter('count')}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span12}`} padding="md" variant="outline">
        <CardHeader
          title="Disponibilidad por zona"
          description="Inventario vivo por oferta, con proyección de agotamiento."
          as="h2"
        />
        <PanelState
          data={data}
          isPending={isPending}
          error={error}
          onRetry={onRetry}
          isEmpty={(value) => value.byZone.length === 0}
          emptyTitle="Sin zonas"
          emptyDescription="No hay filas de zona/tier en el alcance seleccionado."
          skeleton={<PanelSkeleton height={240} lines={0} />}
        >
          {() => (
            <DataTable
              label="Disponibilidad por zona"
              columns={columns}
              data={zoneRows}
              rowKey={(row) => `${row.offerId}-${row.zone}-${row.tierName}`}
              density="compact"
              maxHeight={420}
              defaultSort={{ key: 'daysToSellOut', direction: 'asc' }}
            />
          )}
        </PanelState>
      </Card>
    </div>
  );
}
