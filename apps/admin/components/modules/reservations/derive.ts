import type { InventoryMetrics } from '@boletera/shared';
import type { OrderRow } from '@/lib/queries/orders';
import { parseMoney } from './format';
import type { ReservationRow, ReservationStatus } from './types';

const PENDING_CHECKOUT = new Set([
  'PENDING',
  'AWAITING_PAYMENT',
  'PAYMENT_PENDING',
  'RESERVED',
  'HOLD',
  'DRAFT',
]);

const COMPLETED = new Set(['COMPLETED', 'PAID', 'FULFILLED', 'CONFIRMED']);

function checkoutStatus(order: OrderRow): ReservationStatus {
  const status = order.status.toUpperCase();
  if (COMPLETED.has(status)) return 'completed';
  const ageMin = (Date.now() - new Date(order.createdAt).getTime()) / 60_000;
  if (ageMin >= 12) return 'expired_risk';
  if (status.includes('PAYMENT') || status === 'PENDING') return 'converting';
  return 'active';
}

export function buildReservationRows(
  orders: readonly OrderRow[],
  inventory: InventoryMetrics | undefined,
): ReservationRow[] {
  const checkoutRows: ReservationRow[] = orders
    .filter((order) => PENDING_CHECKOUT.has(order.status.toUpperCase()))
    .map((order) => ({
      id: `order:${order.id}`,
      kind: 'checkout' as const,
      status: checkoutStatus(order),
      title: order.publicId || order.id.slice(0, 8),
      meta: `${order.buyerName || order.buyerEmail || 'Comprador'} · ${order.status}`,
      eventTitle: order.event?.title || 'Sin evento',
      channel: order.channel || '—',
      quantity: 1,
      amount: parseMoney(order.totalAmount),
      currency: order.currency || 'MXN',
      createdAt: order.createdAt,
      buyer: order.buyerName || order.buyerEmail || '—',
    }));

  const zoneRows: ReservationRow[] = (inventory?.byZone ?? [])
    .filter((zone) => zone.holdQuantity > 0)
    .map((zone) => ({
      id: `zone:${zone.eventId}:${zone.offerId}`,
      kind: 'zone_hold' as const,
      status: zone.holdQuantity / Math.max(zone.totalQuantity, 1) >= 0.2 ? 'expired_risk' : 'active',
      title: `${zone.zone} · ${zone.tierName}`,
      meta: `${zone.holdQuantity} asientos en hold`,
      eventTitle: zone.eventTitle,
      channel: 'INVENTORY',
      quantity: zone.holdQuantity,
      amount: 0,
      currency: 'MXN',
      createdAt: inventory?.generatedAt ?? null,
      buyer: 'Operaciones',
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
            buyer: 'Operaciones',
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
  const activeCheckout = rows.filter((row) => row.kind === 'checkout' && row.status !== 'completed');
  const zoneHolds = inventory?.summary.held ?? 0;
  const blocked = inventory?.summary.blocked ?? 0;
  const activeHolds = inventory?.summary.activeHolds ?? activeCheckout.length;

  const completed = orders.filter((order) => COMPLETED.has(order.status.toUpperCase())).length;
  const pending = orders.filter((order) =>
    PENDING_CHECKOUT.has(order.status.toUpperCase()),
  ).length;
  const conversionBase = completed + pending;
  const conversion = conversionBase > 0 ? completed / conversionBase : 0;

  const risk = rows.filter((row) => row.status === 'expired_risk').length;
  const convertingAmount = activeCheckout.reduce((sum, row) => sum + row.amount, 0);

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
  };
}

export function conversionFunnel(orders: readonly OrderRow[]) {
  const pending = orders.filter((order) =>
    PENDING_CHECKOUT.has(order.status.toUpperCase()),
  ).length;
  const completed = orders.filter((order) => COMPLETED.has(order.status.toUpperCase())).length;
  const failed = orders.filter((order) => {
    const status = order.status.toUpperCase();
    return status.includes('CANCEL') || status.includes('FAIL') || status.includes('EXPIRED');
  }).length;

  return [
    { id: 'holds', label: 'Holds / pendientes', value: Math.max(pending, 0) },
    { id: 'completed', label: 'Convertidos a compra', value: Math.max(completed, 0) },
    { id: 'lost', label: 'Cancelados / expirados', value: Math.max(failed, 0) },
  ] as const;
}
