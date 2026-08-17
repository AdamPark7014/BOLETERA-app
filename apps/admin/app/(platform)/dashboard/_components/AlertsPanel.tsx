'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, EmptyState, SegmentedControl } from '@boletera/ui';
import type { MetricsAlert, MetricsAlertsResponse } from '@boletera/shared';
import {
  alertHref,
  formatRelative,
  severityLabel,
  severityTone,
} from '../format';
import { filterAlerts, type AlertFilter } from '../_lib/derive';
import { ListSkeleton, Panel, PanelError } from './Panel';
import styles from '../dashboard.module.scss';

type AlertsPanelProps = {
  data: MetricsAlertsResponse | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

const FILTER_OPTIONS: readonly { value: AlertFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Críticas' },
  { value: 'warning', label: 'Atención' },
  { value: 'info', label: 'Info' },
];

function alertActionHref(alert: MetricsAlert): string {
  return (
    alertHref(alert.entityType, alert.entityId) ??
    (alert.domain === 'fraud'
      ? '/fraud'
      : alert.domain === 'campaigns'
        ? '/campaigns'
        : alert.domain === 'orders'
          ? '/orders'
          : '/events')
  );
}

export function AlertsPanel({ data, loading, error, onRetry }: AlertsPanelProps) {
  const [filter, setFilter] = useState<AlertFilter>('all');
  const alerts = useMemo(() => filterAlerts(data?.alerts, filter, 8), [data?.alerts, filter]);
  const counts = data?.countsBySeverity;

  return (
    <Panel
      headingId="alerts-heading"
      title="Alertas accionables"
      description={
        counts
          ? `${counts.critical} críticas · ${counts.warning} atención · ${counts.info} info`
          : 'Señales derivadas de ritmo, inventario y fraude'
      }
      actions={
        <SegmentedControl
          label="Filtrar alertas por severidad"
          size="sm"
          options={FILTER_OPTIONS}
          value={filter}
          onValueChange={setFilter}
        />
      }
    >
      {loading && !data ? (
        <ListSkeleton rows={3} height={108} />
      ) : error && !data ? (
        <PanelError
          error={error}
          title="No se pudieron cargar las alertas"
          onRetry={onRetry}
        />
      ) : alerts.length === 0 ? (
        <EmptyState
          size="sm"
          tone="success"
          illustration="success"
          title={filter === 'all' ? 'Sin alertas' : 'Nada en este filtro'}
          description={
            filter === 'all'
              ? 'El ritmo de venta, inventario y fraude están dentro de umbrales normales.'
              : 'Prueba otro filtro o vuelve a Todas para ver el resto.'
          }
        />
      ) : (
        <ul className={styles.alertList}>
          {alerts.map((alert) => (
            <li key={alert.id} className={styles.alertItem} data-severity={alert.severity}>
              <div className={styles.alertTop}>
                <Badge tone={severityTone(alert.severity)} size="sm" variant="soft" dot>
                  {severityLabel(alert.severity)}
                </Badge>
                <time className={styles.alertTime} dateTime={alert.detectedAt}>
                  {formatRelative(alert.detectedAt)}
                </time>
              </div>
              <strong className={styles.alertTitle}>{alert.title}</strong>
              <p className={styles.alertBody}>{alert.explanation}</p>
              <p className={styles.alertAction}>{alert.suggestedAction}</p>
              <Link href={alertActionHref(alert)} className={styles.textLink}>
                Ir a {alert.entityLabel ?? 'detalle'} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
