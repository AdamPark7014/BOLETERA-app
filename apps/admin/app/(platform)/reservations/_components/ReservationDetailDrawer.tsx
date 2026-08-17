'use client';

import { useState } from 'react';
import { Badge, Button, Drawer } from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { useReleaseReservationHold } from '@/lib/queries/reservations';
import {
  formatCount,
  formatExpiry,
  formatMoney,
  formatRelative,
} from '../_lib/format';
import {
  KIND_LABEL,
  KIND_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type ReservationRow,
} from '../_lib/types';
import styles from '../reservations.module.scss';

type ReservationDetailDrawerProps = {
  row: ReservationRow | null;
  onClose: () => void;
};

export function ReservationDetailDrawer({ row, onClose }: ReservationDetailDrawerProps) {
  const toast = useToast();
  const release = useReleaseReservationHold();
  const [holdIdInput, setHoldIdInput] = useState('');

  const canRelease =
    row?.kind === 'checkout' || row?.kind === 'zone_hold' || Boolean(row?.holdId);

  async function onRelease() {
    const holdId = (row?.holdId || holdIdInput).trim();
    if (!holdId) {
      toast.error('Indica el ID del hold a liberar (SeatHold).');
      return;
    }
    try {
      const result = await release.mutateAsync({ holdId });
      if (result.released) {
        toast.success('Hold liberado; el inventario vuelve a AVAILABLE.');
        onClose();
      } else {
        toast.info(`Hold no activo (${result.status ?? 'desconocido'}).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo liberar el hold.';
      toast.error(message);
    }
  }

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={row?.title}
      description={row?.eventTitle}
      footer={
        <div className={styles.drawerActions}>
          {canRelease ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={release.isPending}
              onClick={() => void onRelease()}
            >
              Liberar hold
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {row ? (
        <div className={styles.drawerBody}>
          <div className={styles.badgeRow}>
            <Badge tone={KIND_TONE[row.kind]} variant="soft" size="sm" dot>
              {KIND_LABEL[row.kind]}
            </Badge>
            <Badge tone={STATUS_TONE[row.status]} variant="soft" size="sm" dot>
              {STATUS_LABEL[row.status]}
            </Badge>
          </div>
          <dl className={styles.metaGrid}>
            <div>
              <dt>Cupos</dt>
              <dd>{formatCount(row.quantity)}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{row.amount > 0 ? formatMoney(row.amount, row.currency) : '—'}</dd>
            </div>
            <div>
              <dt>Canal</dt>
              <dd>{row.channel}</dd>
            </div>
            <div>
              <dt>Edad</dt>
              <dd>{formatRelative(row.createdAt)}</dd>
            </div>
            <div>
              <dt>Expiración</dt>
              <dd>{formatExpiry(row.expiresAt)}</dd>
            </div>
            <div>
              <dt>Responsable</dt>
              <dd>{row.buyer}</dd>
            </div>
            <div>
              <dt>Evento</dt>
              <dd>{row.eventTitle}</dd>
            </div>
            <div>
              <dt>Pedido</dt>
              <dd>{row.orderId ? row.orderId.slice(0, 10) : '—'}</dd>
            </div>
          </dl>
          <p className={styles.muted}>{row.meta}</p>

          {!row.holdId && canRelease ? (
            <label className={styles.releaseField}>
              <span>ID de SeatHold (si lo conoces)</span>
              <input
                value={holdIdInput}
                onChange={(event) => setHoldIdInput(event.target.value)}
                placeholder="hold_…"
                autoComplete="off"
              />
            </label>
          ) : null}

          <p className={styles.muted}>
            Liberación explícita: DELETE /inventory/holds/:id. Esta vista agrega pedidos
            pendientes, expiraciones/cancelaciones e inventario retenido sin inventar holds.
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}
