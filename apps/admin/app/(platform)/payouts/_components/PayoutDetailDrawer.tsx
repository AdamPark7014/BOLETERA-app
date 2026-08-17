'use client';

import { Badge, Button, Drawer, Timeline, type TimelineItem } from '@boletera/ui';
import { formatMoney } from '../_lib/money';
import { canCompletePayout, payoutStatusMeta } from '../_lib/payouts';
import { formatDay } from '../_lib/period';
import type { PayoutRow } from '../_lib/types';
import styles from '../payouts.module.scss';

type PayoutDetailDrawerProps = {
  payout: PayoutRow | null;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onComplete: (payout: PayoutRow) => void;
};

/** Construye el hilo auditable de una liquidación a partir de sus fechas. */
function buildTimeline(payout: PayoutRow): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: 'created',
      title: 'Liquidación generada',
      description: `Periodo ${formatDay(payout.periodStart)} – ${formatDay(payout.periodEnd)}`,
      timestamp: payout.createdAt ?? payout.periodStart ?? undefined,
      tone: 'neutral',
    },
  ];

  if (payout.status === 'PROCESSING' || payout.processedAt) {
    items.push({
      id: 'processing',
      title: 'En proceso SPEI',
      description: payout.referenceId
        ? `Referencia provisional: ${payout.referenceId}`
        : 'Esperando confirmación bancaria',
      timestamp: payout.processedAt ?? undefined,
      tone: 'info',
      current: payout.status === 'PROCESSING',
    });
  }

  if (payout.status === 'COMPLETED') {
    items.push({
      id: 'completed',
      title: 'Pago confirmado',
      description: payout.referenceId
        ? `Clave de rastreo ${payout.referenceId}`
        : 'Transferencia marcada como completada',
      timestamp: payout.processedAt ?? undefined,
      tone: 'success',
      current: true,
    });
  }

  if (payout.status === 'FAILED') {
    items.push({
      id: 'failed',
      title: 'Pago fallido',
      description: 'Revisa la cuenta destino y vuelve a intentar el SPEI.',
      timestamp: payout.processedAt ?? undefined,
      tone: 'danger',
      current: true,
    });
  }

  if (payout.status === 'CANCELLED') {
    items.push({
      id: 'cancelled',
      title: 'Liquidación cancelada',
      timestamp: payout.processedAt ?? undefined,
      tone: 'neutral',
      current: true,
    });
  }

  if (payout.status === 'PENDING') {
    items.push({
      id: 'pending',
      title: 'Pendiente de pago',
      description: 'Lista para transferirse cuando el SPEI esté listo.',
      tone: 'warning',
      current: true,
    });
  }

  return items;
}

export function PayoutDetailDrawer({
  payout,
  canManage,
  busy,
  onClose,
  onComplete,
}: PayoutDetailDrawerProps) {
  const meta = payout ? payoutStatusMeta(payout.status) : null;
  const completeAllowed = Boolean(payout && canManage && canCompletePayout(payout));

  return (
    <Drawer
      open={payout !== null}
      onClose={onClose}
      title={
        payout
          ? `${formatDay(payout.periodStart)} – ${formatDay(payout.periodEnd)}`
          : 'Liquidación'
      }
      description={payout ? `Neto ${formatMoney(payout.netCents)}` : undefined}
      size="md"
      footer={
        payout ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cerrar
            </Button>
            {completeAllowed ? (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() => onComplete(payout)}
              >
                Marcar pagado
              </Button>
            ) : (
              !canManage &&
              canCompletePayout(payout) && (
                <span className={styles.muted} role="status">
                  Requiere rol ADMIN o SUPER_ADMIN
                </span>
              )
            )}
          </>
        ) : null
      }
    >
      {payout && meta && (
        <div className={styles.drawerBody}>
          <div className={styles.drawerStatus}>
            <Badge tone={meta.tone} variant="soft" size="sm" dot>
              {meta.label}
            </Badge>
            {payout.method && (
              <Badge tone="neutral" variant="outline" size="sm">
                {payout.method}
              </Badge>
            )}
          </div>

          <dl className={styles.metaList}>
            <div>
              <dt>Bruto</dt>
              <dd className={styles.amount}>{formatMoney(payout.grossCents)}</dd>
            </div>
            <div>
              <dt>Comisión</dt>
              <dd className={styles.amount}>{formatMoney(payout.commissionCents)}</dd>
            </div>
            <div>
              <dt>Neto</dt>
              <dd className={styles.amount}>{formatMoney(payout.netCents)}</dd>
            </div>
            <div>
              <dt>Referencia</dt>
              <dd>
                {payout.referenceId ? (
                  <code className={styles.code}>{payout.referenceId}</code>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Identificador</dt>
              <dd>
                <code className={styles.code}>{payout.id}</code>
              </dd>
            </div>
          </dl>

          <section aria-label="Historial de la liquidación">
            <h3 className={styles.drawerHeading}>Timeline</h3>
            <Timeline
              label={`Historial de la liquidación ${payout.id}`}
              items={buildTimeline(payout)}
              density="sm"
            />
            <p className={styles.srOnly}>
              Estado actual: {meta.label}.
            </p>
          </section>
        </div>
      )}
    </Drawer>
  );
}
