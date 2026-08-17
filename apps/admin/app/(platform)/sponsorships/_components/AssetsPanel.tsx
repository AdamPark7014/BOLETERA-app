'use client';

import { EmptyState, ProgressRing } from '@boletera/ui';
import { formatCount, formatRatio } from '../_lib/money';
import { assetTypeLabel, type AssetHealth } from '../_lib/packages';
import { PanelState } from './PanelState';
import styles from '../sponsorships.module.scss';

type AssetsPanelProps = {
  rows: readonly AssetHealth[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
};

export function AssetsPanel({ rows, isPending, error, onRetry }: AssetsPanelProps) {
  return (
    <aside className={styles.card} aria-label="Inventario de assets">
      <div className={styles.cardHead}>
        <div>
          <h2>Assets</h2>
          <p>Utilización del inventario comercial</p>
        </div>
      </div>

      <PanelState
        data={rows}
        isPending={isPending}
        error={error}
        onRetry={onRetry}
        isEmpty={(items) => items.length === 0}
        emptyTitle="Sin assets"
        emptyDescription="Inventaría espacios, impresiones y cortesías antes de vender."
        emptyHints={['GET /sponsorships/organization/:orgId/assets']}
      >
        {(items) => {
          const top = [...items].sort((a, b) => b.utilization - a.utilization)[0];
          return (
            <>
              {top ? (
                <div className={styles.assetLead}>
                  <ProgressRing
                    value={Math.round(top.utilization * 100)}
                    max={100}
                    size={56}
                    thickness={6}
                    tone={
                      top.utilization >= 0.9
                        ? 'danger'
                        : top.utilization >= 0.7
                          ? 'warning'
                          : 'success'
                    }
                    label={`Utilización de ${top.name}`}
                  />
                  <div>
                    <strong>{top.name}</strong>
                    <small>
                      {assetTypeLabel(top.type)} · {formatRatio(top.utilization)} usado
                    </small>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Sin assets"
                  description="Catálogo vacío."
                  illustration="inbox"
                  size="sm"
                />
              )}
              <ul className={styles.sideList}>
                {items.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {assetTypeLabel(item.type)} · {formatCount(item.remaining)} libres
                        {item.exclusiveCategory
                          ? ` · exclusividad ${item.exclusiveCategory}`
                          : ''}
                      </small>
                    </div>
                    <strong className={styles.rate}>{formatRatio(item.utilization)}</strong>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </PanelState>
    </aside>
  );
}
