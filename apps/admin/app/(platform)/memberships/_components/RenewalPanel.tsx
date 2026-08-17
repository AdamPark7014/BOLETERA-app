'use client';

import { AreaChart, Badge, Button, EmptyState } from '@boletera/ui';
import type { MembershipRenewal } from '@/lib/queries/memberships';
import { formatCount, formatMoney, toCents } from '../_lib/money';
import { renewalStatusMeta } from '../_lib/plans';
import { PanelState } from './PanelState';
import styles from '../memberships.module.scss';

type RenewalPanelProps = {
  renewals: readonly MembershipRenewal[] | undefined;
  retention: ReadonlyArray<{ label: string; value: number }> | undefined;
  renewalsPending: boolean;
  retentionPending: boolean;
  renewalsError: unknown;
  retentionError: unknown;
  onRetryRenewals?: () => void;
  onRetryRetention?: () => void;
  onRenew?: (membershipId: string) => void;
  renewBusyId?: string | null;
  canManage: boolean;
};

export function RenewalPanel({
  renewals,
  retention,
  renewalsPending,
  retentionPending,
  renewalsError,
  retentionError,
  onRetryRenewals,
  onRetryRetention,
  onRenew,
  renewBusyId,
  canManage,
}: RenewalPanelProps) {
  return (
    <div className={styles.renewalGrid}>
      <aside className={styles.card} aria-label="Cola de renovaciones">
        <div className={styles.cardHead}>
          <div>
            <h2>Renovaciones</h2>
            <p>Cola operativa por vencimiento</p>
          </div>
        </div>

        <PanelState
          data={renewals}
          isPending={renewalsPending}
          error={renewalsError}
          onRetry={onRetryRenewals}
          isEmpty={(rows) => rows.length === 0}
          emptyTitle="Sin renovaciones"
          emptyDescription="No hay membresías en ventana de renovación."
          emptyHints={['GET /memberships/organization/:orgId/renewals']}
        >
          {(rows) => (
            <ul className={styles.sideList}>
              {rows.slice(0, 10).map((item) => {
                const meta = renewalStatusMeta(item.status);
                return (
                  <li key={item.id}>
                    <div>
                      <strong>{item.memberName}</strong>
                      <small>
                        {item.planName} · vence{' '}
                        {new Date(item.expiresAt).toLocaleDateString('es-MX')}
                        {item.amount != null
                          ? ` · ${formatMoney(toCents(item.amount))}`
                          : ''}
                      </small>
                      <div className={styles.inlineBadge}>
                        <Badge tone={meta.tone} variant="soft" size="sm" dot>
                          {meta.label}
                        </Badge>
                      </div>
                    </div>
                    {canManage &&
                    onRenew &&
                    (item.status.toUpperCase() === 'DUE' ||
                      item.status.toUpperCase() === 'OVERDUE') ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={renewBusyId === item.membershipId}
                        onClick={() => onRenew(item.membershipId)}
                      >
                        Renovar
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelState>
      </aside>

      <aside className={styles.card} aria-label="Retención">
        <div className={styles.cardHead}>
          <div>
            <h2>Retención</h2>
            <p>Serie real cuando el endpoint responde</p>
          </div>
        </div>

        <PanelState
          data={retention}
          isPending={retentionPending}
          error={retentionError}
          onRetry={onRetryRetention}
          isEmpty={(rows) => rows.length === 0}
          emptyTitle="Sin serie de retención"
          emptyDescription="La curva se activa con GET …/retention."
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                title="Sin puntos"
                description="El endpoint devolvió una serie vacía."
                illustration="chart"
                size="sm"
              />
            ) : (
              <>
                <AreaChart
                  label="Retención (%)"
                  height={180}
                  series={[
                    {
                      id: 'retention',
                      name: 'Retención',
                      data: rows,
                    },
                  ]}
                  formatValue={(value) => `${Math.round(value)}%`}
                  formatAxis={(value) => `${Math.round(value)}%`}
                />
                <p className={styles.muted}>
                  {formatCount(rows.length)} punto{rows.length === 1 ? '' : 's'} de retención
                </p>
              </>
            )
          }
        </PanelState>
      </aside>
    </div>
  );
}
