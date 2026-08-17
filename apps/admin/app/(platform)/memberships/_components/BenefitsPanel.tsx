'use client';

import { BarChart, EmptyState } from '@boletera/ui';
import { formatCount } from '../_lib/money';
import { PanelState } from './PanelState';
import styles from '../memberships.module.scss';

type BenefitsPanelProps = {
  usage: ReadonlyArray<{ label: string; value: number }> | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
};

export function BenefitsPanel({ usage, isPending, error, onRetry }: BenefitsPanelProps) {
  return (
    <aside className={styles.card} aria-label="Uso de beneficios">
      <div className={styles.cardHead}>
        <div>
          <h2>Beneficios canjeados</h2>
          <p>Top de redenciones reales</p>
        </div>
      </div>

      <PanelState
        data={usage}
        isPending={isPending}
        error={error}
        onRetry={onRetry}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="Sin canjes"
        emptyDescription="Cuando haya usage de beneficios, verás el ranking aquí."
        emptyHints={['GET /memberships/organization/:orgId/benefits/usage']}
      >
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              title="Sin canjes"
              description="Aún no hay redenciones registradas."
              illustration="inbox"
              size="sm"
            />
          ) : (
            <BarChart
              label="Canjes por beneficio"
              height={180}
              series={[
                {
                  id: 'redemptions',
                  name: 'Canjes',
                  data: rows,
                },
              ]}
              formatValue={(value) => formatCount(value)}
              formatAxis={(value) => formatCount(value)}
            />
          )
        }
      </PanelState>
    </aside>
  );
}
