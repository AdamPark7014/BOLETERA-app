'use client';

import { Badge, Card, CardHeader, EmptyState, StatusDot } from '@boletera/ui';
import type { MetricsDimensionRow } from '@boletera/shared';
import { formatCount } from './format';
import styles from './scanner.module.scss';

type Props = {
  rows: readonly MetricsDimensionRow[];
  total: number;
  loading: boolean;
  available: boolean;
};

function toneForShare(percent: number): 'success' | 'accent' | 'warning' | 'neutral' {
  if (percent >= 40) return 'success';
  if (percent >= 20) return 'accent';
  if (percent >= 5) return 'warning';
  return 'neutral';
}

/** Puertas / puntos de acceso derivados de tráfico por zona cuando hay datos. */
export function AccessPointsPanel({ rows, total, loading, available }: Props) {
  return (
    <Card className={styles.panel} padding="md">
      <CardHeader
        title="Puertas y dispositivos"
        description="Tráfico por punto de acceso en el rango"
        actions={
          available ? (
            <Badge tone="success" variant="soft" size="sm" dot>
              Con datos
            </Badge>
          ) : (
            <Badge tone="neutral" variant="outline" size="sm">
              Sin telemetría
            </Badge>
          )
        }
      />

      {!available && !loading ? (
        <EmptyState
          title="Sin estado de puertas"
          description="Cuando existan escaneos con zona/access point, aparecerán aquí como dispositivos activos."
          illustration="inbox"
          size="sm"
        />
      ) : loading && rows.length === 0 ? (
        <ul className={styles.doorList} aria-busy="true" aria-label="Cargando puntos de acceso">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.doorRow}>
              <span className={styles.skeletonBar} style={{ width: '42%' }} />
              <span className={styles.skeletonBar} style={{ width: '18%' }} />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Ningún punto reportó tráfico"
          description="Los escaneos exitosos con zona asignada alimentan este panel."
          illustration="inbox"
          size="sm"
        />
      ) : (
        <ul className={styles.doorList} aria-label="Puntos de acceso">
          {rows.map((row) => {
            const percent =
              row.percentOfTotal ??
              (total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0);
            return (
              <li key={row.key} className={styles.doorRow}>
                <div className={styles.doorMeta}>
                  <StatusDot
                    tone={toneForShare(percent)}
                    pulse={percent >= 15}
                    label={row.label || row.key}
                  />
                  <span className={styles.doorShare}>{percent.toFixed(1)} %</span>
                </div>
                <div className={styles.doorBarTrack} aria-hidden="true">
                  <span
                    className={styles.doorBarFill}
                    style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                  />
                </div>
                <strong className={styles.doorCount}>{formatCount(row.value)}</strong>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
