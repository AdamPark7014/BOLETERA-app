import type { OrderRow } from '@/lib/queries/orders';
import { parseMoney } from './format';
import {
  SEGMENT_LABEL,
  SEGMENT_TONE,
  type CrmCustomerRow,
  type CrmSegmentCard,
  type CustomerSegment,
} from './types';

const COMPLETED = new Set(['COMPLETED', 'PAID', 'FULFILLED', 'CONFIRMED']);

function isCompleted(status: string): boolean {
  return COMPLETED.has(status.toUpperCase());
}

function classifySegment(
  completedOrders: number,
  totalSpend: number,
  lastOrderAt: string | null,
  vipThreshold: number,
): CustomerSegment {
  const lastMs = lastOrderAt ? new Date(lastOrderAt).getTime() : NaN;
  const daysSince =
    Number.isFinite(lastMs) ? Math.floor((Date.now() - lastMs) / 86_400_000) : Number.POSITIVE_INFINITY;

  if (daysSince > 180) return 'inactive';
  if (daysSince > 90 && completedOrders > 0) return 'at_risk';
  if (totalSpend >= vipThreshold && completedOrders >= 2) return 'vip';
  if (completedOrders >= 2) return 'recurrent';
  if (completedOrders === 1) return 'new';
  return 'inactive';
}

export function buildCustomerRows(orders: readonly OrderRow[]): CrmCustomerRow[] {
  type Acc = {
    name: string;
    email: string;
    ordersCount: number;
    completedOrders: number;
    totalSpend: number;
    currency: string;
    lastOrderAt: string | null;
    firstOrderAt: string | null;
    channels: Set<string>;
    eventCounts: Map<string, number>;
  };

  const byEmail = new Map<string, Acc>();

  for (const order of orders) {
    const email = order.buyerEmail?.trim().toLowerCase() || 'sin-email';
    const existing = byEmail.get(email);
    const amount = isCompleted(order.status) ? parseMoney(order.totalAmount) : 0;
    const eventTitle = order.event?.title?.trim() || 'Sin evento';

    if (!existing) {
      byEmail.set(email, {
        name: order.buyerName?.trim() || 'Cliente sin nombre',
        email: order.buyerEmail?.trim() || 'Sin correo',
        ordersCount: 1,
        completedOrders: isCompleted(order.status) ? 1 : 0,
        totalSpend: amount,
        currency: order.currency || 'MXN',
        lastOrderAt: order.createdAt,
        firstOrderAt: order.createdAt,
        channels: new Set(order.channel ? [order.channel] : []),
        eventCounts: new Map([[eventTitle, 1]]),
      });
      continue;
    }

    existing.ordersCount += 1;
    if (isCompleted(order.status)) existing.completedOrders += 1;
    existing.totalSpend += amount;
    if (!existing.name || existing.name === 'Cliente sin nombre') {
      existing.name = order.buyerName?.trim() || existing.name;
    }
    if (order.channel) existing.channels.add(order.channel);
    existing.eventCounts.set(eventTitle, (existing.eventCounts.get(eventTitle) ?? 0) + 1);

    const created = new Date(order.createdAt).getTime();
    if (
      !existing.lastOrderAt ||
      created > new Date(existing.lastOrderAt).getTime()
    ) {
      existing.lastOrderAt = order.createdAt;
    }
    if (
      !existing.firstOrderAt ||
      created < new Date(existing.firstOrderAt).getTime()
    ) {
      existing.firstOrderAt = order.createdAt;
    }
  }

  const spends = [...byEmail.values()]
    .map((row) => row.totalSpend)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  const vipThreshold =
    spends.length >= 4 ? spends[Math.floor(spends.length * 0.1)] ?? spends[0] ?? 0 : spends[0] ?? 0;

  return [...byEmail.entries()]
    .map(([id, row]) => {
      let topEvent = 'Sin evento';
      let topCount = -1;
      for (const [title, count] of row.eventCounts) {
        if (count > topCount) {
          topCount = count;
          topEvent = title;
        }
      }
      const segment = classifySegment(
        row.completedOrders,
        row.totalSpend,
        row.lastOrderAt,
        vipThreshold,
      );
      return {
        id,
        name: row.name,
        email: row.email,
        ordersCount: row.ordersCount,
        completedOrders: row.completedOrders,
        totalSpend: row.totalSpend,
        currency: row.currency,
        lastOrderAt: row.lastOrderAt,
        firstOrderAt: row.firstOrderAt,
        channels: [...row.channels].join(', ') || '—',
        topEvent,
        segment,
      } satisfies CrmCustomerRow;
    })
    .sort((a, b) => b.totalSpend - a.totalSpend || b.ordersCount - a.ordersCount);
}

export function buildSegmentCards(customers: readonly CrmCustomerRow[]): CrmSegmentCard[] {
  const order: CustomerSegment[] = ['vip', 'recurrent', 'new', 'at_risk', 'inactive'];
  return order.map((id) => {
    const members = customers.filter((row) => row.segment === id);
    return {
      id,
      label: SEGMENT_LABEL[id],
      description:
        id === 'vip'
          ? 'Decil superior de gasto con compras repetidas'
          : id === 'recurrent'
            ? 'Dos o más pedidos completados'
            : id === 'new'
              ? 'Primera compra en el portafolio'
              : id === 'at_risk'
                ? 'Sin actividad reciente (90–180 días)'
                : 'Sin compras recientes o sin pedidos pagados',
      count: members.length,
      spend: members.reduce((sum, row) => sum + row.totalSpend, 0),
      tone: SEGMENT_TONE[id],
    };
  });
}

export function crmKpis(customers: readonly CrmCustomerRow[]) {
  const active = customers.filter((row) => row.segment !== 'inactive');
  const recurrent = customers.filter((row) => row.completedOrders >= 2);
  const spend = customers.reduce((sum, row) => sum + row.totalSpend, 0);
  const avgLtv = customers.length ? spend / customers.length : 0;
  const retention = customers.length ? recurrent.length / customers.length : 0;
  return {
    customers: customers.length,
    active: active.length,
    avgLtv,
    retention,
    spend,
  };
}
