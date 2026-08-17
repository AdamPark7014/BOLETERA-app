'use client';

import { BarChart, EmptyState, ProgressRing } from '@boletera/ui';
import { formatCount, formatMoney, formatRatio } from '../_lib/money';
import type { SeasonBucket } from '../_lib/passes';
import styles from '../season.module.scss';

type AdoptionPanelProps = {
  buckets: readonly SeasonBucket[];
  loading: boolean;
};

export function AdoptionPanel({ buckets, loading }: AdoptionPanelProps) {
  const top = buckets[0] ?? null;

  return (
    <aside className={styles.card} aria-label="Adopción por temporada">
      <div className={styles.cardHead}>
        <div>
          <h2>Adopción por temporada</h2>
          <p>Comparativa de renovación y llenado</p>
        </div>
        {top ? (
          <ProgressRing
            value={Math.round(top.rate * 100)}
            max={100}
            size={56}
            thickness={6}
            tone={top.rate >= 0.7 ? 'success' : top.rate >= 0.4 ? 'warning' : 'danger'}
            label={`Adopción de ${top.label}`}
          />
        ) : null}
      </div>

      {loading ? (
        <p className={styles.muted} role="status">
          Calculando adopción…
        </p>
      ) : buckets.length === 0 ? (
        <EmptyState
          title="Sin temporadas"
          description="Los datos aparecerán al crear abonos."
          illustration="chart"
          size="sm"
        />
      ) : (
        <>
          <BarChart
            label="Adopción por temporada"
            height={160}
            series={[
              {
                id: 'adoption',
                name: 'Adopción %',
                data: buckets.map((bucket) => ({
                  label: bucket.label,
                  value: Math.round(bucket.rate * 100),
                })),
              },
            ]}
            formatValue={(value) => `${Math.round(value)}%`}
            formatAxis={(value) => `${Math.round(value)}%`}
          />
          <ul className={styles.seasonList}>
            {buckets.map((item) => (
              <li key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <small>
                    {formatCount(item.count)} abono{item.count === 1 ? '' : 's'} ·{' '}
                    {formatCount(item.sold)}/{formatCount(item.capacity)} ·{' '}
                    {formatMoney(item.revenueCents)}
                  </small>
                </div>
                <strong className={styles.rate}>{formatRatio(item.rate)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
