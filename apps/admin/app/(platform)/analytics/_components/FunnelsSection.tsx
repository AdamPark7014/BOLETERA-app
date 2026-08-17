'use client';

import { useMemo } from 'react';
import type { CampaignFunnelMetrics, WaitlistMetrics } from '@boletera/shared';
import { Badge, type BadgeTone } from '@boletera/ui/src/components/Badge';
import { BarChart } from '@boletera/ui/src/components/BarChart';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { FunnelChart } from '@boletera/ui/src/components/FunnelChart';
import {
  formatCount,
  formatMoney,
  formatPercentPoints,
} from '../_lib/format';
import { funnelToStages, largestFunnelDrop, rowsToSeries } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelState, PanelSkeleton } from './PanelState';

type PromoRow = CampaignFunnelMetrics['promotions'][number] & Record<string, unknown>;

const PERF_TONE: Record<PromoRow['performance'], BadgeTone> = {
  strong: 'success',
  average: 'neutral',
  poor: 'warning',
};

const PERF_LABEL: Record<PromoRow['performance'], string> = {
  strong: 'Fuerte',
  average: 'Media',
  poor: 'Baja',
};

export function FunnelsSection({
  waitlist,
  waitlistPending,
  waitlistError,
  onRetryWaitlist,
  campaigns,
  campaignsPending,
  campaignsError,
  onRetryCampaigns,
}: {
  waitlist: WaitlistMetrics | undefined;
  waitlistPending: boolean;
  waitlistError: unknown;
  onRetryWaitlist: () => void;
  campaigns: CampaignFunnelMetrics | undefined;
  campaignsPending: boolean;
  campaignsError: unknown;
  onRetryCampaigns: () => void;
}) {
  const waitlistStages = useMemo(
    () => (waitlist ? funnelToStages(waitlist.funnel) : []),
    [waitlist],
  );

  const campaignStages = useMemo(
    () => (campaigns ? funnelToStages(campaigns.funnel) : []),
    [campaigns],
  );

  const waitlistByEvent = useMemo(
    () => (waitlist ? rowsToSeries(waitlist.byEvent, 'waitlist-events', 'En lista') : []),
    [waitlist],
  );

  const waitlistDrop = useMemo(
    () => (waitlist ? largestFunnelDrop(waitlist.funnel) : null),
    [waitlist],
  );

  const promoRows = useMemo<PromoRow[]>(
    () => (campaigns?.promotions ?? []).map((promo) => ({ ...promo })),
    [campaigns],
  );

  const promoColumns = useMemo<DataTableColumn<PromoRow>[]>(
    () => [
      {
        key: 'code',
        header: 'Promoción',
        width: 200,
        sortValue: (row) => row.code,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.cellPrimary}>{row.code}</span>
            <span className={styles.cellSecondary}>{row.name}</span>
          </div>
        ),
      },
      {
        key: 'usageCount',
        header: 'Usos',
        align: 'right',
        width: 110,
        sortValue: (row) => row.usageCount,
        render: (row) => (
          <span className={styles.numeric}>
            {formatCount(row.usageCount)}
            {row.usageLimit !== null ? ` / ${formatCount(row.usageLimit)}` : ''}
          </span>
        ),
      },
      {
        key: 'ordersAttributed',
        header: 'Órdenes',
        align: 'right',
        width: 100,
        sortValue: (row) => row.ordersAttributed,
        render: (row) => (
          <span className={styles.numeric}>{formatCount(row.ordersAttributed)}</span>
        ),
      },
      {
        key: 'revenueAttributed',
        header: 'Ingreso',
        align: 'right',
        width: 120,
        sortValue: (row) => row.revenueAttributed,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.revenueAttributed)}</span>
        ),
      },
      {
        key: 'discountGiven',
        header: 'Descuento',
        align: 'right',
        width: 120,
        sortValue: (row) => row.discountGiven,
        render: (row) => (
          <span className={styles.numeric}>{formatMoney(row.discountGiven)}</span>
        ),
      },
      {
        key: 'conversionRate',
        header: 'Conversión',
        align: 'right',
        width: 110,
        sortValue: (row) => row.conversionRate,
        render: (row) => (
          <span className={styles.numeric}>
            {formatPercentPoints(row.conversionRate, 0)}
          </span>
        ),
      },
      {
        key: 'performance',
        header: 'Rendimiento',
        width: 120,
        sortValue: (row) => row.performance,
        render: (row) => (
          <Badge tone={PERF_TONE[row.performance]} size="sm" dot>
            {PERF_LABEL[row.performance]}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className={styles.grid}>
      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader
          title="Embudo de lista de espera"
          description="Del cupo en lista a la conversión en compra."
          as="h2"
        />
        <PanelState
          data={waitlist}
          isPending={waitlistPending}
          error={waitlistError}
          onRetry={onRetryWaitlist}
          isEmpty={(value) => value.funnel.stages.every((stage) => stage.count === 0)}
          emptyTitle="Lista de espera vacía"
          emptyDescription="Cuando haya entradas en lista de espera verás el embudo de notificación y conversión."
          skeleton={<PanelSkeleton height={180} lines={1} />}
        >
          {(value) => (
            <>
              <FunnelChart
                label="Embudo de lista de espera"
                stages={waitlistStages}
                conversionBase="previous"
                formatValue={formatCount}
              />
              <dl className={styles.statList}>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Pendientes</dt>
                  <dd className={styles.statValue}>{formatCount(value.summary.pending)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Convertidos</dt>
                  <dd className={styles.statValue}>{formatCount(value.summary.converted)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt className={styles.statLabel}>Conversión</dt>
                  <dd className={styles.statValue}>
                    {formatPercentPoints(value.summary.conversionRate)}
                  </dd>
                </div>
              </dl>
              {waitlistDrop ? (
                <p className={styles.panelFootnote}>
                  Mayor caída: de «{waitlistDrop.previousLabel}» a «{waitlistDrop.label}» retiene{' '}
                  {formatPercentPoints(waitlistDrop.retainedPercent, 0)}.
                </p>
              ) : null}
            </>
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader
          title="Embudo de campañas"
          description="Cupo asignado → canjes → órdenes con ingreso."
          as="h2"
        />
        <PanelState
          data={campaigns}
          isPending={campaignsPending}
          error={campaignsError}
          onRetry={onRetryCampaigns}
          isEmpty={(value) => value.funnel.stages.every((stage) => stage.count === 0)}
          emptyTitle="Sin actividad de campañas"
          emptyDescription="Crea promociones o amplía el rango para ver el embudo de atribución."
          skeleton={<PanelSkeleton height={180} lines={1} />}
        >
          {() => (
            <FunnelChart
              label="Embudo de campañas"
              stages={campaignStages}
              conversionBase="previous"
              formatValue={formatCount}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader title="Lista de espera por evento" as="h2" />
        <PanelState
          data={waitlist}
          isPending={waitlistPending}
          error={waitlistError}
          onRetry={onRetryWaitlist}
          isEmpty={(value) => value.byEvent.length === 0}
          emptyTitle="Sin demanda en lista"
          emptyDescription="Los eventos con entradas en lista aparecerán ordenados por volumen."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {() => (
            <BarChart
              label="Lista de espera por evento"
              series={waitlistByEvent}
              height={220}
              formatValue={formatCount}
            />
          )}
        </PanelState>
      </Card>

      <Card className={`${styles.panel} ${styles.span6}`} padding="md" variant="outline">
        <CardHeader
          title="Rendimiento de promociones"
          description="Ingreso atribuido, descuento otorgado y conversión vs cupo."
          as="h2"
        />
        <PanelState
          data={campaigns}
          isPending={campaignsPending}
          error={campaignsError}
          onRetry={onRetryCampaigns}
          isEmpty={(value) => value.promotions.length === 0}
          emptyTitle="Sin promociones"
          emptyDescription="No hay códigos de promoción con actividad en el periodo."
          skeleton={<PanelSkeleton height={200} lines={0} />}
        >
          {() => (
            <DataTable
              label="Rendimiento de promociones"
              columns={promoColumns}
              data={promoRows}
              rowKey={(row) => row.promotionId}
              density="compact"
              maxHeight={360}
              defaultSort={{ key: 'revenueAttributed', direction: 'desc' }}
            />
          )}
        </PanelState>
      </Card>
    </div>
  );
}
