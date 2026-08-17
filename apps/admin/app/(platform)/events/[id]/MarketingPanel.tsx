'use client';

import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  FunnelChart,
} from '@boletera/ui';
import type { CampaignFunnelMetrics } from '@boletera/shared';
import type { Campaign } from '@/lib/queries/campaigns';
import {
  formatCount,
  formatMxn,
  formatPercentPoints,
  statusTone,
} from './format';
import styles from './event-hub.module.scss';

type Props = {
  campaigns: Campaign[] | undefined;
  campaignsLoading: boolean;
  campaignsError: string | null;
  funnel: CampaignFunnelMetrics | undefined;
  funnelLoading: boolean;
  funnelError: string | null;
};

export function MarketingPanel({
  campaigns,
  campaignsLoading,
  campaignsError,
  funnel,
  funnelLoading,
  funnelError,
}: Props) {
  const list = campaigns ?? [];
  const promotions = funnel?.promotions ?? [];
  const funnelStages =
    funnel?.funnel.stages.map((stage) => ({
      id: stage.key,
      label: stage.label,
      value: stage.count,
    })) ?? [];

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-marketing"
      aria-labelledby="hub-tab-marketing"
    >
      <Card variant="outline" padding="md">
        <CardHeader
          title="Campañas del evento"
          description="Listado real desde /campaigns"
        />
        {campaignsError ? (
          <EmptyState
            title="No se pudieron cargar campañas"
            description={campaignsError}
            illustration="error"
            tone="danger"
            size="sm"
          />
        ) : campaignsLoading && list.length === 0 ? (
          <EmptyState
            title="Cargando campañas…"
            description="Consultando campañas asociadas al evento."
            illustration="inbox"
            size="sm"
          />
        ) : list.length === 0 ? (
          <EmptyState
            title="Sin campañas"
            description="Este evento no tiene campañas registradas todavía."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <div className={styles.tableWrap} role="region" aria-label="Campañas">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Asignación</th>
                  <th scope="col">Descuento</th>
                  <th scope="col">Canjeados</th>
                </tr>
              </thead>
              <tbody>
                {list.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>{campaign.type}</td>
                    <td>
                      <Badge tone={statusTone(campaign.status)} variant="soft" size="sm" dot>
                        {campaign.status}
                      </Badge>
                    </td>
                    <td>{formatCount(campaign.allocation)}</td>
                    <td>{formatPercentPoints(campaign.discountValue)}</td>
                    <td>{formatCount(campaign.redeemed ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className={styles.grid2}>
        <Card variant="outline" padding="md">
          <CardHeader
            title="Embudo de campañas"
            description="Métricas agregadas del periodo (filtradas por evento cuando el backend lo soporta)"
          />
          {funnelError ? (
            <EmptyState
              title="No se pudo cargar el embudo"
              description={funnelError}
              illustration="error"
              tone="danger"
              size="sm"
            />
          ) : funnelLoading && funnelStages.length === 0 ? (
            <EmptyState
              title="Cargando embudo…"
              description="Consultando métricas de campañas."
              illustration="chart"
              size="sm"
            />
          ) : funnelStages.length === 0 ? (
            <EmptyState
              title="Sin datos de embudo"
              description="No hay etapas de embudo disponibles para este alcance."
              illustration="chart"
              size="sm"
            />
          ) : (
            <FunnelChart
              label="Embudo de marketing del evento"
              stages={funnelStages}
            />
          )}
        </Card>

        <Card variant="outline" padding="md">
          <CardHeader
            title="Promociones atribuidas"
            description="Uso e ingreso atribuido por código"
          />
          {funnelError ? (
            <EmptyState
              title="Métricas no disponibles"
              description={funnelError}
              illustration="error"
              tone="danger"
              size="sm"
            />
          ) : promotions.length === 0 ? (
            <EmptyState
              title="Sin promociones en el periodo"
              description="No hay códigos con uso atribuido en los últimos 30 días."
              illustration="inbox"
              size="sm"
            />
          ) : (
            <div className={styles.tableWrap} role="region" aria-label="Promociones">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Uso</th>
                    <th scope="col">Órdenes</th>
                    <th scope="col">Ingreso</th>
                    <th scope="col">Rendimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((promo) => (
                    <tr key={promo.promotionId}>
                      <td>{promo.code || promo.name}</td>
                      <td>
                        {formatCount(promo.usageCount)}
                        {promo.usageLimit != null ? ` / ${formatCount(promo.usageLimit)}` : ''}
                      </td>
                      <td>{formatCount(promo.ordersAttributed)}</td>
                      <td>{formatMxn(promo.revenueAttributed)}</td>
                      <td>
                        <Badge
                          tone={
                            promo.performance === 'strong'
                              ? 'success'
                              : promo.performance === 'poor'
                                ? 'danger'
                                : 'neutral'
                          }
                          variant="soft"
                          size="sm"
                        >
                          {promo.performance}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
