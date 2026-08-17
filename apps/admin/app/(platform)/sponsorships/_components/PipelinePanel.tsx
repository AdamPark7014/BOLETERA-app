'use client';

import { Badge, EmptyState } from '@boletera/ui';
import { formatCount, formatMoney } from '../_lib/money';
import type { PipelineStage } from '../_lib/packages';
import styles from '../sponsorships.module.scss';

type PipelinePanelProps = {
  stages: readonly PipelineStage[];
  loading: boolean;
};

export function PipelinePanel({ stages, loading }: PipelinePanelProps) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <aside className={styles.card} aria-label="Pipeline comercial">
      <div className={styles.cardHead}>
        <div>
          <h2>Pipeline</h2>
          <p>Etapas del embudo de paquetes</p>
        </div>
        <Badge tone="neutral" variant="soft" size="sm">
          {formatCount(total)}
        </Badge>
      </div>

      {loading ? (
        <p className={styles.muted} role="status">
          Armando pipeline…
        </p>
      ) : stages.every((stage) => stage.count === 0) ? (
        <EmptyState
          title="Sin paquetes"
          description="El pipeline se llena al crear paquetes o activaciones."
          illustration="chart"
          size="sm"
        />
      ) : (
        <ul className={styles.pipelineList}>
          {stages.map((stage) => (
            <li key={stage.status}>
              <div className={styles.pipelineRow}>
                <Badge tone={stage.tone} variant="soft" size="sm" dot>
                  {stage.label}
                </Badge>
                <strong>{formatCount(stage.count)}</strong>
              </div>
              <div
                className={styles.bar}
                role="meter"
                aria-label={`${stage.label}: ${stage.count}`}
                aria-valuemin={0}
                aria-valuemax={Math.max(total, 1)}
                aria-valuenow={stage.count}
              >
                <span
                  style={{
                    width: `${total > 0 ? (stage.count / total) * 100 : 0}%`,
                  }}
                />
              </div>
              <small className={styles.muted}>{formatMoney(stage.valueCents)}</small>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
