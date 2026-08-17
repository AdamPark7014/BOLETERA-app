'use client';

import { Badge, BarChart, EmptyState } from '@boletera/ui';
import { centsToUnits, formatCount, formatMoney, formatMoneyCompact, toCents } from '../_lib/money';
import type { AgingBucket } from '../_lib/types';
import styles from '../payouts.module.scss';

type AgingPanelProps = {
  buckets: readonly AgingBucket[];
  loading: boolean;
};

/** Antigüedad del saldo abierto: cuánto lleva el dinero sin salir del banco. */
export function AgingPanel({ buckets, loading }: AgingPanelProps) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.amountCents, 0);
  const overdue = buckets
    .filter((bucket) => bucket.fromDays >= 16)
    .reduce((sum, bucket) => sum + bucket.amountCents, 0);

  return (
    <section className={styles.card} aria-label="Antigüedad de saldos">
      <header className={styles.cardHead}>
        <h2>Antigüedad del saldo</h2>
        {overdue > 0 && (
          <Badge tone="danger" variant="soft" size="sm">
            {formatMoney(overdue)} vencido
          </Badge>
        )}
      </header>

      {loading ? (
        <p className={styles.muted} role="status">
          Calculando antigüedad…
        </p>
      ) : total === 0 ? (
        <EmptyState
          title="Sin saldo abierto"
          description="Todas las liquidaciones del histórico están pagadas o canceladas."
          illustration="success"
          tone="success"
          size="sm"
        />
      ) : (
        <>
          <BarChart
            label="Saldo abierto por tramo de antigüedad"
            height={180}
            series={[
              {
                id: 'aging',
                name: 'Saldo abierto',
                data: buckets.map((bucket) => ({
                  label: bucket.label,
                  value: centsToUnits(bucket.amountCents),
                })),
              },
            ]}
            formatValue={(value) => formatMoney(toCents(value))}
            formatAxis={(value) => formatMoneyCompact(toCents(value))}
          />
          <ul className={styles.agingList}>
            {buckets.map((bucket) => (
              <li key={bucket.id}>
                <Badge tone={bucket.tone} variant="soft" size="sm" dot>
                  {bucket.label}
                </Badge>
                <span className={styles.agingCount}>
                  {formatCount(bucket.count)} liquidación(es)
                </span>
                <span className={styles.amount}>{formatMoney(bucket.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
