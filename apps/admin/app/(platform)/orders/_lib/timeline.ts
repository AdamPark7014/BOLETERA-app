import type { TimelineItem, TimelineTone } from '@boletera/ui/src/components/Timeline';
import type { ActivityItem } from '@boletera/ui/src/components/ActivityFeed';
import type { AuditEntry } from '@/lib/queries/audit';
import { formatDateTime, money, statusMeta } from './format';
import type { OrderDetailView, OrderFraudFlag } from './types';

function toneForStatus(status: string): TimelineTone {
  const tone = statusMeta(status).tone;
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'danger') return 'danger';
  if (tone === 'info') return 'info';
  if (tone === 'accent') return 'accent';
  return 'neutral';
}

/** Lifecycle timeline derived from order timestamps + refunds + payment. */
export function buildOrderTimeline(order: OrderDetailView): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: 'created',
      title: 'Orden creada',
      description: `${order.publicId} · ${order.channel}`,
      timestamp: order.createdAt,
      tone: 'accent',
    },
  ];

  if (order.payment) {
    items.push({
      id: `payment-${order.payment.status}`,
      title: `Pago ${order.payment.status.toLowerCase()}`,
      description: `${order.payment.gateway}${
        order.payment.externalId ? ` · ${order.payment.externalId}` : ''
      }`,
      timestamp: order.payment.processedAt ?? order.payment.createdAt ?? order.createdAt,
      tone: toneForStatus(
        order.payment.status === 'COMPLETED'
          ? 'COMPLETED'
          : order.payment.status === 'FAILED'
            ? 'FAILED'
            : 'PENDING',
      ),
      current: !order.completedAt && order.status === 'PENDING',
    });
  }

  if (order.completedAt) {
    items.push({
      id: 'completed',
      title: 'Orden completada',
      description: money(order.totalAmount, order.currency),
      timestamp: order.completedAt,
      tone: 'success',
      current: order.status === 'COMPLETED',
    });
  }

  for (const refund of order.refunds) {
    items.push({
      id: `refund-${refund.id}`,
      title: `Reembolso ${refund.status.toLowerCase()}`,
      description: `${money(refund.amount, order.currency)}${
        refund.notes ? ` — ${refund.notes}` : ''
      }`,
      timestamp: refund.processedAt ?? refund.requestedAt,
      tone:
        refund.status === 'COMPLETED'
          ? 'success'
          : refund.status === 'FAILED'
            ? 'danger'
            : 'warning',
      current: refund.status === 'PENDING',
    });
  }

  if (order.refundedAt) {
    items.push({
      id: 'refunded',
      title: 'Orden reembolsada',
      timestamp: order.refundedAt,
      tone: 'neutral',
      current: order.status === 'REFUNDED',
    });
  }

  if (order.status === 'CANCELLED') {
    items.push({
      id: 'cancelled',
      title: 'Orden cancelada',
      timestamp: order.updatedAt ?? order.createdAt,
      tone: 'danger',
      current: true,
    });
  }

  if (order.status === 'FAILED') {
    items.push({
      id: 'failed',
      title: 'Orden fallida',
      description: order.payment?.errorMessage ?? 'El pago no se completó',
      timestamp: order.updatedAt ?? order.createdAt,
      tone: 'danger',
      current: true,
    });
  }

  return items.sort((a, b) => {
    const ta = a.timestamp ? +new Date(a.timestamp) : 0;
    const tb = b.timestamp ? +new Date(b.timestamp) : 0;
    return ta - tb;
  });
}

export function buildAuditFeed(
  entries: readonly AuditEntry[],
  orderId: string,
  publicId: string,
): ActivityItem[] {
  return entries
    .filter(
      (entry) =>
        entry.entityId === orderId ||
        entry.entityId === publicId ||
        (typeof entry.metadata?.publicId === 'string' &&
          entry.metadata.publicId === publicId),
    )
    .map((entry) => ({
      id: entry.id,
      actor: 'Sistema',
      action: entry.action,
      target: entry.entityType,
      timestamp: entry.createdAt,
      detail:
        entry.metadata && Object.keys(entry.metadata).length
          ? JSON.stringify(entry.metadata)
          : undefined,
    }));
}

export function fraudTone(severity: string): TimelineTone {
  const s = severity.toUpperCase();
  if (s === 'CRITICAL' || s === 'HIGH') return 'danger';
  if (s === 'MEDIUM') return 'warning';
  return 'info';
}

export function orderFraudFlags(
  flags: readonly OrderFraudFlag[],
  orderId: string,
): OrderFraudFlag[] {
  return flags.filter((flag) => flag.orderId === orderId);
}

export function describeSeat(ticket: {
  section: string | null;
  row: string | null;
  seatNumber: string | null;
}): string {
  const parts = [ticket.section, ticket.row, ticket.seatNumber].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Sin asiento asignado';
}

export { formatDateTime };
