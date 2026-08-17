'use client';

import type { MetricsAlert, MetricsAlertSeverity } from '@boletera/shared';
import { Badge, type BadgeTone } from '@boletera/ui/src/components/Badge';
import { Button } from '@boletera/ui/src/components/Button';
import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import { formatTimestamp } from '../_lib/format';
import { humanizeKey } from '../_lib/series';
import styles from '../analytics.module.scss';
import { PanelEmpty, PanelError, PanelSkeleton } from './PanelState';

const SEVERITY_TONE: Record<MetricsAlertSeverity, BadgeTone> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

const SEVERITY_LABEL: Record<MetricsAlertSeverity, string> = {
  info: 'Info',
  warning: 'Advertencia',
  critical: 'Crítica',
};

export function AlertsPanel({
  alerts,
  counts,
  isPending,
  error,
  onRetry,
}: {
  alerts: readonly MetricsAlert[] | undefined;
  counts:
    | Record<MetricsAlertSeverity, number>
    | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Card className={styles.panel} padding="md" variant="outline">
      <CardHeader
        title="Alertas"
        description="Recomendaciones derivadas de los agregados del periodo."
        as="h2"
        actions={
          counts ? (
            <div className={styles.inlineMeta} aria-label="Conteo por severidad">
              <Badge tone="danger" size="sm">
                {counts.critical} críticas
              </Badge>
              <Badge tone="warning" size="sm">
                {counts.warning} advertencias
              </Badge>
              <Badge tone="info" size="sm">
                {counts.info} info
              </Badge>
            </div>
          ) : null
        }
      />

      {isPending ? (
        <div aria-busy="true">
          <PanelSkeleton height={72} lines={2} />
        </div>
      ) : null}

      {error ? <PanelError error={error} onRetry={onRetry} /> : null}

      {!isPending && !error && (!alerts || alerts.length === 0) ? (
        <PanelEmpty
          title="Sin alertas en el periodo"
          description="Los umbrales de ritmo de venta, reembolsos, fraude e inventario no dispararon ninguna recomendación."
        />
      ) : null}

      {!isPending && !error && alerts && alerts.length > 0 ? (
        <ul className={styles.alertList}>
          {alerts.map((alert) => (
            <li key={alert.id} className={styles.alert}>
              <div className={styles.alertHead}>
                <Badge tone={SEVERITY_TONE[alert.severity]} size="sm" dot>
                  {SEVERITY_LABEL[alert.severity]}
                </Badge>
                <Badge tone="neutral" size="sm" variant="outline">
                  {humanizeKey(alert.domain)}
                </Badge>
                <h3 className={styles.alertTitle}>{alert.title}</h3>
              </div>
              <p className={styles.alertText}>{alert.explanation}</p>
              <p className={styles.alertAction}>
                <strong>Acción sugerida:</strong> {alert.suggestedAction}
              </p>
              <div className={styles.alertMeta}>
                <span>Detectada {formatTimestamp(alert.detectedAt)}</span>
                {alert.entityLabel ? <span>{alert.entityLabel}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {error || isPending ? null : (
        <div className={styles.inlineMeta}>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Actualizar alertas
          </Button>
        </div>
      )}
    </Card>
  );
}
