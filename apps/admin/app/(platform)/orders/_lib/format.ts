import type {
  MetricsRangeKey,
  OrderDetailView,
  OrderException,
  OrderRowLike,
  OrderStatus,
  SalesChannel,
  StatusMeta,
} from './types';

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  COMPLETED: { label: 'Completada', tone: 'success' },
  PENDING: { label: 'Pendiente', tone: 'warning' },
  CANCELLED: { label: 'Cancelada', tone: 'danger' },
  REFUNDED: { label: 'Reembolsada', tone: 'neutral' },
  PARTIALLY_REFUNDED: { label: 'Reembolso parcial', tone: 'info' },
  FAILED: { label: 'Fallida', tone: 'danger' },
};

export const CHANNEL_LABELS: Record<SalesChannel, string> = {
  WEB: 'Web',
  TAQUILLA: 'Taquilla',
  POS: 'POS',
  API: 'API',
  ADMIN: 'Admin',
  RESALE: 'Reventa',
};

export const RANGE_OPTIONS: ReadonlyArray<{ value: MetricsRangeKey; label: string; days: number }> = [
  { value: '7d', label: '7 días', days: 7 },
  { value: '30d', label: '30 días', days: 30 },
  { value: '90d', label: '90 días', days: 90 },
];

export const STALE_PENDING_HOURS = 2;

export function isOrderStatus(value: string): value is OrderStatus {
  return value in STATUS_META;
}

export function isSalesChannel(value: string): value is SalesChannel {
  return value in CHANNEL_LABELS;
}

export function isMetricsRangeKey(value: string): value is MetricsRangeKey {
  return value === '7d' || value === '30d' || value === '90d';
}

export function statusMeta(status: string): StatusMeta {
  if (isOrderStatus(status)) return STATUS_META[status];
  return { label: status, tone: 'neutral' };
}

export function channelLabel(channel: string): string {
  if (isSalesChannel(channel)) return CHANNEL_LABELS[channel];
  return channel;
}

export function money(amount: string | number | null | undefined, currency = 'MXN'): string {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  if (!Number.isFinite(n)) return String(amount ?? '—');
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function kpiDeltaRatio(deltaPercent: number | null | undefined): number | undefined {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return undefined;
  return deltaPercent / 100;
}

export function formatKpiValue(
  value: number,
  unit: 'mxn' | 'count' | 'percent' | 'ratio' | undefined,
): string {
  if (unit === 'mxn') return money(value);
  if (unit === 'percent') {
    return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
  }
  if (unit === 'ratio') {
    return value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

export function metricsRangeIso(range: MetricsRangeKey): { from: string; to: string } {
  const days = RANGE_OPTIONS.find((o) => o.value === range)?.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function orderMatchesQuery(order: OrderRowLike, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    order.publicId.toLowerCase().includes(q) ||
    (order.buyerName?.toLowerCase().includes(q) ?? false) ||
    (order.buyerEmail?.toLowerCase().includes(q) ?? false) ||
    order.event.title.toLowerCase().includes(q)
  );
}

export function collectExceptions(orders: readonly OrderRowLike[]): OrderException[] {
  const now = Date.now();
  const out: OrderException[] = [];

  for (const order of orders) {
    if (order.status === 'FAILED') {
      out.push({
        orderId: order.id,
        publicId: order.publicId,
        kind: 'failed',
        label: 'Pago fallido',
        createdAt: order.createdAt,
      });
    }

    if (order.status === 'PENDING') {
      const ageMs = now - new Date(order.createdAt).getTime();
      if (ageMs > STALE_PENDING_HOURS * 60 * 60 * 1000) {
        out.push({
          orderId: order.id,
          publicId: order.publicId,
          kind: 'stale_pending',
          label: `Pendiente > ${STALE_PENDING_HOURS} h`,
          createdAt: order.createdAt,
        });
      }
    }

    if (order.status === 'PARTIALLY_REFUNDED') {
      out.push({
        orderId: order.id,
        publicId: order.publicId,
        kind: 'partial_refund',
        label: 'Reembolso parcial',
        createdAt: order.createdAt,
      });
    }
  }

  return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function canCancel(order: { status: string }): boolean {
  return order.status === 'PENDING' || order.status === 'FAILED';
}

export function canResendEmail(order: { status: string }): boolean {
  return order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED';
}

export function canRequestRefund(order: { status: string }): boolean {
  return order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED';
}

export function flattenTickets(order: OrderDetailView) {
  return order.items.flatMap((item) => item.tickets);
}

export type { OrderRowLike };
