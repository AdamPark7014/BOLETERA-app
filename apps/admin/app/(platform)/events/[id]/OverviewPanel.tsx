'use client';

import Link from 'next/link';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
} from '@boletera/ui';
import type {
  EventSalesPaceRow,
  MetricsAlert,
  MetricsTimePoint,
} from '@boletera/shared';
import type { EventHub } from '@/lib/platform-api';
import { SalesCurve } from './SalesCurve';
import {
  channelLabel,
  formatCount,
  formatMxn,
  formatPercentPoints,
  formatRatioPercent,
  riskLabel,
  riskTone,
  severityLabel,
  severityTone,
} from './format';
import styles from './event-hub.module.scss';

type Props = {
  hub: EventHub;
  pace: EventSalesPaceRow | null;
  paceLoading: boolean;
  paceError: string | null;
  curvePoints: readonly MetricsTimePoint[];
  curveLoading: boolean;
  curveError: string | null;
  alerts: readonly MetricsAlert[];
  alertsLoading: boolean;
  alertsError: string | null;
};

export function OverviewPanel({
  hub,
  pace,
  paceLoading,
  paceError,
  curvePoints,
  curveLoading,
  curveError,
  alerts,
  alertsLoading,
  alertsError,
}: Props) {
  const { inventory, channels } = hub;
  const channelRevenue = channels.reduce(
    (sum, row) => sum + Number(row._sum.totalAmount ?? 0),
    0,
  );

  return (
    <div className={styles.tabPanel} role="tabpanel" id="hub-panel-overview" aria-labelledby="hub-tab-overview">
      <section className={styles.kpiStrip} aria-label="Indicadores del evento">
        <KpiCard
          label="Ocupación"
          value={formatPercentPoints(inventory.occupancyPercent)}
          hint={`${formatCount(inventory.sold)} de ${formatCount(inventory.total)}`}
          tone={inventory.occupancyPercent >= 80 ? 'warning' : 'success'}
          loading={false}
        />
        <KpiCard
          label="Disponibles"
          value={formatCount(inventory.available)}
          hint={`${formatCount(inventory.held)} en hold`}
          tone="neutral"
        />
        <KpiCard
          label="Órdenes"
          value={formatCount(hub.event._count?.orders ?? 0)}
          hint="Completadas / registradas en hub"
          tone="neutral"
        />
        <KpiCard
          label="Ingreso canales"
          value={formatMxn(channelRevenue)}
          unit="MXN"
          hint="Suma reportada por canal en hub"
          tone="accent"
        />
        <KpiCard
          label="Ritmo real"
          value={pace ? formatRatioPercent(pace.actualPace) : '—'}
          hint={pace ? `Esperado ${formatRatioPercent(pace.expectedPace)}` : 'Sin métrica de ritmo'}
          tone={pace ? riskTone(pace.riskLevel) : 'neutral'}
          loading={paceLoading}
        />
        <KpiCard
          label="Delta de ritmo"
          value={
            pace
              ? formatPercentPoints(pace.paceDelta * 100)
              : '—'
          }
          hint={pace ? riskLabel(pace.riskLevel) : 'No disponible para este evento'}
          tone={pace ? riskTone(pace.riskLevel) : 'neutral'}
          loading={paceLoading}
          delta={pace ? pace.paceDelta : undefined}
          deltaLabel="vs. ritmo esperado"
        />
      </section>

      {paceError ? (
        <p className={styles.hintDanger} role="status">
          Ritmo de venta: {paceError}
        </p>
      ) : null}

      <div className={styles.grid2}>
        <SalesCurve
          points={curvePoints}
          loading={curveLoading}
          errorMessage={curveError ?? undefined}
        />

        <Card variant="outline" padding="md">
          <CardHeader
            title="Alertas del evento"
            description="Señales accionables filtradas a este evento"
          />
          {alertsError ? (
            <EmptyState
              title="No se pudieron cargar alertas"
              description={alertsError}
              illustration="error"
              tone="danger"
              size="sm"
            />
          ) : alertsLoading && alerts.length === 0 ? (
            <EmptyState
              title="Cargando alertas…"
              description="Consultando métricas del periodo."
              illustration="inbox"
              size="sm"
            />
          ) : alerts.length === 0 ? (
            <EmptyState
              title="Sin alertas para este evento"
              description="No hay alertas abiertas asociadas a este evento en los últimos 30 días."
              illustration="success"
              size="sm"
            />
          ) : (
            <ul className={styles.alertList}>
              {alerts.map((alert) => (
                <li key={alert.id} className={styles.alertItem}>
                  <div className={styles.alertTitle}>
                    <Badge tone={severityTone(alert.severity)} variant="soft" size="sm" dot>
                      {severityLabel(alert.severity)}
                    </Badge>
                    <span>{alert.title}</span>
                  </div>
                  <p className={styles.alertCopy}>{alert.explanation}</p>
                  <p className={styles.alertCopy}>{alert.suggestedAction}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Ventas por canal"
          description="Datos del hub del evento (órdenes e ingresos agregados)"
        />
        {channels.length === 0 ? (
          <EmptyState
            title="Sin ventas por canal"
            description="Aún no hay órdenes atribuidas a canales para este evento."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <div className={styles.tableWrap} role="region" aria-label="Ventas por canal">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Órdenes</th>
                  <th scope="col">Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((row) => (
                  <tr key={row.channel}>
                    <td>{channelLabel(row.channel)}</td>
                    <td>{formatCount(row._count)}</td>
                    <td>{formatMxn(Number(row._sum.totalAmount ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.hint}>
          Detalle de asignación en{' '}
          <Link href="?tab=channels">Canales</Link>
          {pace ? (
            <>
              {' '}
              · Capacidad restante {formatCount(pace.remainingCapacity)} · Ingreso bruto métricas{' '}
              {formatMxn(pace.grossRevenue)}
            </>
          ) : null}
        </p>
      </Card>
    </div>
  );
}
