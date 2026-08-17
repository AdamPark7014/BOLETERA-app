'use client';

import {
  Badge,
  Button,
  Drawer,
  formatNumber,
} from '@boletera/ui';
import type { InventoryAvailability } from '@/lib/queries/inventory';
import {
  formatAvailability,
  formatCount,
  formatDaysToSellOut,
  formatVelocity,
} from '../_lib/format';
import { statusCountValue } from '../_lib/derive';
import {
  PRESSURE_LABEL,
  PRESSURE_TONE,
  type InventoryZoneTableRow,
} from '../_lib/types';
import styles from '../inventory.module.scss';

type ZoneDetailDrawerProps = {
  row: InventoryZoneTableRow | null;
  availability: InventoryAvailability | undefined;
  availabilityPending: boolean;
  onClose: () => void;
};

export function ZoneDetailDrawer({
  row,
  availability,
  availabilityPending,
  onClose,
}: ZoneDetailDrawerProps) {
  const counts = availability?.statusCounts;
  const blockedLive = statusCountValue(counts, ['BLOCKED', 'RESERVED_OPS', 'COMP']);
  const heldLive = statusCountValue(counts, ['HELD']);
  const soldLive = statusCountValue(counts, ['SOLD', 'USED', 'TRANSFERRED']);
  const availableLive = statusCountValue(counts, ['AVAILABLE']);

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={row?.zone}
      description={row?.eventTitle}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {row ? (
        <div className={styles.drawerBody}>
          <Badge tone={PRESSURE_TONE[row.pressure]} variant="soft" size="sm" dot>
            Presión {PRESSURE_LABEL[row.pressure]}
          </Badge>
          <dl className={styles.metaGrid}>
            <div>
              <dt>Tier</dt>
              <dd>{row.tierName}</dd>
            </div>
            <div>
              <dt>Aforo zona</dt>
              <dd>{formatCount(row.totalQuantity)}</dd>
            </div>
            <div>
              <dt>Disponibles</dt>
              <dd>{formatCount(row.remainingQuantity)}</dd>
            </div>
            <div>
              <dt>Holds</dt>
              <dd>{formatCount(row.holdQuantity)}</dd>
            </div>
            <div>
              <dt>Vendidos</dt>
              <dd>{formatCount(row.soldQuantity)}</dd>
            </div>
            <div>
              <dt>Disponibilidad</dt>
              <dd>{formatAvailability(row.availabilityPercent)}</dd>
            </div>
            <div>
              <dt>Velocidad</dt>
              <dd>{formatVelocity(row.sellThroughVelocity)}</dd>
            </div>
            <div>
              <dt>Agotamiento est.</dt>
              <dd>{formatDaysToSellOut(row.daysToSellOut)}</dd>
            </div>
          </dl>

          <section className={styles.liveBlock} aria-label="Disponibilidad en vivo">
            <h3 className={styles.liveTitle}>Disponibilidad en vivo</h3>
            {availabilityPending ? (
              <p className={styles.muted}>Consultando /inventory/…/availability…</p>
            ) : availability ? (
              <ul className={styles.liveList}>
                <li>
                  <span>Activos en hold</span>
                  <strong>{formatNumber(availability.activeHolds)}</strong>
                </li>
                <li>
                  <span>AVAILABLE</span>
                  <strong>{formatNumber(availableLive)}</strong>
                </li>
                <li>
                  <span>HELD</span>
                  <strong>{formatNumber(heldLive)}</strong>
                </li>
                <li>
                  <span>SOLD+</span>
                  <strong>{formatNumber(soldLive)}</strong>
                </li>
                <li>
                  <span>Bloqueos / otros</span>
                  <strong>{formatNumber(blockedLive)}</strong>
                </li>
              </ul>
            ) : (
              <p className={styles.muted}>
                Sin snapshot de disponibilidad para este evento.
              </p>
            )}
          </section>

          <p className={styles.muted}>
            Offer {row.offerId}. Liberaciones programadas usan DELETE /inventory/holds/:id.
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}
