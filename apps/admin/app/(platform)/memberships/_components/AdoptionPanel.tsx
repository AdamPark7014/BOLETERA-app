'use client';

import { BarChart, EmptyState, ProgressRing } from '@boletera/ui';
import { formatCount, formatMoney, formatRatio } from '../_lib/money';
import type { TierBucket } from '../_lib/plans';
import styles from '../memberships.module.scss';

type AdoptionPanelProps = {
  buckets: readonly TierBucket[];
  loading: boolean;
};

export function AdoptionPanel({ buckets, loading }: AdoptionPanelProps) {
  const top = buckets[0] ?? null;

  return (
    <aside className={styles.card} aria-label="Adopción por tier">
      <div className={styles.cardHead}>
        <div>
          <h2>Adopción por tier</h2>
          <p>Miembros e ingreso por nivel</p>
        </div>
        {top ? (
          <ProgressRing
            value={top.members}
            max={Math.max(top.members, 1)}
            size={56}
            thickness={6}
            tone="accent"
            label={`Miembros en ${top.tier}`}
          />
        ) : null}
      </div>

      {loading ? (
        <p className={styles.muted} role="status">
          Calculando adopción…
        </p>
      ) : buckets.length === 0 ? (
        <EmptyState
          title="Sin tiers"
          description="Los datos aparecen al publicar planes."
          illustration="chart"
          size="sm"
        />
      ) : (
        <>
          <BarChart
            label="Miembros por tier"
            height={160}
            series={[
              {
                id: 'members',
                name: 'Miembros',
                data: buckets.map((bucket) => ({
                  label: bucket.tier,
                  value: bucket.members,
                })),
              },
            ]}
            formatValue={(value) => formatCount(value)}
            formatAxis={(value) => formatCount(value)}
          />
          <ul className={styles.sideList}>
            {buckets.map((item) => (
              <li key={item.tier}>
                <div>
                  <strong>{item.tier}</strong>
                  <small>
                    {formatCount(item.plans)} plan{item.plans === 1 ? '' : 'es'} ·{' '}
                    {formatMoney(item.revenueCents)}
                    {item.renewalRate != null
                      ? ` · renovación ${formatRatio(item.renewalRate)}`
                      : ''}
                  </small>
                </div>
                <strong className={styles.rate}>{formatCount(item.members)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
