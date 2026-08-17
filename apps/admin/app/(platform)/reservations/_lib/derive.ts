import type { InventoryMetrics } from '@boletera/shared';
import type { OrderRow } from '@/lib/queries/orders';
import { parseMoney } from './format';
import type { ReservationKind, ReservationRow, ReservationStatus } from './types';

const PENDING_CHECKOUT = new Set([
  'PENDING',
  'AWAITING_PAYMENT',
  'PAYMENT_PENDING',
  'RESERVED',
  'HOLD',
  'DRAFT',
]);

const COMPLETED = new Set(['COMPLETED', 'PAID', 'FULFILLED', 'CONFIRMED']);

const RELEASED = new Set(['CANCELLED', 'CANCELED']);

const EXPIRED = new Set(['EXPIRED', 'TIMEOUT', 'ABANDONED']);

const WEB_TTL_MS = 15 * 60_000;

function checkoutStatus(order: OrderRow): ReservationStatus {
  const status = order.status.toUpperCase();
  if (COMPLETED.has(status)) return 'completed';
  if (RELEASED.has(status)) return 'released';
  if (EXPIRED.has(status) || status.includes('EXPIRED')) return 'expired';
  const ageMin = (Date.now() - new Date(order.createdAt).getTime()) / 60_000;
  if (ageMin >= 12) return 'expired_risk';
  if (status.includes('PAYMENT') || status === 'PENDING') return 'converting';
  return 'active';
}

function checkoutKind(order: OrderRow): ReservationKind {
  const status = order.status.toUpperCase();
  if (RELEASED.has(status)) return 'released';
  if (EXPIRED.has(status) || status.includes('EXPIRED')) return 'expired';
  return 'checkout';
}

function estimateExpiry(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + WEB_TTL_MS).toISOString();
}

export function buildReservationRows(
  orders: readonly OrderRow[],
  inventory: InventoryMetrics | undefined,
): ReservationRow[] {
  const checkoutRows: ReservationRow[] = orders
    .filter((order) => {
      const status = order.status.toUpperCase();
      return (
        PENDING_CHECKOUT.has(status) ||
        COMPLETED.has(status) ||
        RELEASED.has(status) ||
        EXPIRED.has(status) ||
        status.includes('EXPIRED')
      );
    })
    .map((order) => {
      const status = checkoutStatus(order);
      const kind = checkoutKind(order);
      const pending = PENDING_CHECKOUT.has(order.status.toUpperCase());
      return {
        id: `order:${order.id}`,
        kind,
        status,
        title: order.publicId || order.id.slice(0, 8),
        meta: `${order.buyerName || order.buyerEmail || 'Comprador'} · ${order.status}`,
        eventTitle: order.event?.title || 'Sin evento',
        channel: order.channel || '—',
        quantity: 1,
        amount: parseMoney(order.totalAmount),
        currency: order.currency || 'MXN',
        createdAt: order.createdAt,
        expiresAt: pending ? estimateExpiry(order.createdAt) : null,
        buyer: order.buyerName || order.buyerEmail || '—',
        holdId: null,
        orderId: order.id,
      };
    });

  const zoneRows: ReservationRow[] = (inventory?.byZone ?? [])
    .filter((zone) => zone.holdQuantity > 0)
    .map((zone) => ({
      id: `zone:${zone.eventId}:${zone.offerId}`,
      kind: 'zone_hold' as const,
      status:
        zone.holdQuantity / Math.max(zone.totalQuantity, 1) >= 0.2
          ? ('expired_risk' as const)
          : ('active' as const),
      title: `${zone.zone} · ${zone.tierName}`,
      meta: `${zone.holdQuantity} asientos en hold`,
      eventTitle: zone.eventTitle,
      channel: 'INVENTORY',
      quantity: zone.holdQuantity,
      amount: 0,
      currency: 'MXN',
      createdAt: inventory?.generatedAt ?? null,
      expiresAt: null,
      buyer: 'Operaciones',
      holdId: null,
      orderId: null,
    }));

  const blocked =
    inventory && inventory.summary.blocked > 0
      ? [
          {
            id: 'blocked:summary',
            kind: 'blocked' as const,
            status: 'active' as const,
            title: 'Bloqueos operativos',
            meta: 'VIP / prensa / producción / cortesía (agregado)',
            eventTitle: 'Portafolio',
            channel: 'OPS',
            quantity: inventory.summary.blocked,
            amount: 0,
            currency: 'MXN',
            createdAt: inventory.generatedAt,
            expiresAt: null,
            buyer: 'Operaciones',
            holdId: null,
            orderId: null,
          } satisfies ReservationRow,
        ]
      : [];

  return [...checkoutRows, ...zoneRows, ...blocked].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime || b.quantity - a.quantity;
  });
}

export function reservationKpis(
  rows: readonly ReservationRow[],
  inventory: InventoryMetrics | undefined,
  orders: readonly OrderRow[],
) {
  const activeCheckout = rows.filter(
    (row) => row.kind === 'checkout' && row.status !== 'completed',
  );
  const zoneHolds = inventory?.summary.held ?? 0;
  const blocked = inventory?.summary.blocked ?? 0;
  const activeHolds = inventory?.summary.activeHolds ?? activeCheckout.length;

  const completed = orders.filter((order) => COMPLETED.has(order.status.toUpperCase())).length;
  const pending = orders.filter((order) =>
    PENDING_CHECKOUT.has(order.status.toUpperCase()),
  ).length;
  const released = orders.filter((order) => RELEASED.has(order.status.toUpperCase())).length;
  const expired = orders.filter((order) => {
    const status = order.status.toUpperCase();
    return EXPIRED.has(status) || status.includes('EXPIRED');
  }).length;
  const conversionBase = completed + pending;
  const conversion = conversionBase > 0 ? completed / conversionBase : 0;

  const risk = rows.filter((row) => row.status === 'expired_risk').length;
  const convertingAmount = activeCheckout.reduce((sum, row) => sum + row.amount, 0);
  const expiringSoon = rows.filter((row) => {
    if (!row.expiresAt) return false;
    const ms = new Date(row.expiresAt).getTime() - Date.now();
    return ms > 0 && ms <= 5 * 60_000;
  }).length;

  return {
    activeReservations: activeCheckout.length + (zoneHolds > 0 ? 1 : 0),
    activeHolds,
    zoneHolds,
    blocked,
    conversion,
    risk,
    convertingAmount,
    pending,
    completed,
    released,
    expired,
    expiringSoon,
  };
}

export function conversionFunnel(orders: readonly OrderRow[]) {
  const pending = orders.filter((order) =>
    PENDING_CHECKOUT.has(order.status.toUpperCase()),
  ).length;
  const completed = orders.filter((order) => COMPLETED.has(order.status.toUpperCase())).length;
  const lost = orders.filter((order) => {
    const status = order.status.toUpperCase();
    return (
      RELEASED.has(status) ||
      EXPIRED.has(status) ||
      status.includes('FAIL') ||
      status.includes('EXPIRED')
    );
  }).length;

  return [
    { id: 'holds', label: 'Holds / pendientes', value: Math.max(pending, 0) },
    { id: 'completed', label: 'Convertidos a compra', value: Math.max(completed, 0) },
    { id: 'lost', label: 'Liberados / expirados', value: Math.max(lost, 0) },
  ] as const;
}

export function buildReleaseTimeline(rows: readonly ReservationRow[]) {
  return rows
    .filter(
      (row) =>
        row.status === 'released' ||
        row.status === 'expired' ||
        row.status === 'expired_risk' ||
        row.status === 'converting' ||
        row.status === 'completed' ||
        row.kind === 'zone_hold',
    )
    .slice(0, 10);
}
