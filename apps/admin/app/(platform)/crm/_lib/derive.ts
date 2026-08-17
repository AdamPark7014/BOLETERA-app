import type { AiCustomerSegmentRow } from '@boletera/shared';
import type { OrderRow } from '@/lib/queries/orders';
import { parseMoney } from './format';
import { SEGMENT_DESCRIPTION, SEGMENT_LABEL, SEGMENT_TONE } from './labels';
import type {
  ChurnBand,
  CrmCustomerRow,
  CrmKpis,
  CrmSegmentCard,
  CustomerSegment,
  RfmScores,
} from './types';

const COMPLETED = new Set(['COMPLETED', 'PAID', 'FULFILLED', 'CONFIRMED']);

function isCompleted(status: string): boolean {
  return COMPLETED.has(status.toUpperCase());
}

function daysSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function scoreByThresholds(value: number, thresholds: readonly number[]): number {
  // thresholds ascending: [t1,t2,t3,t4] → score 1..5
  let score = 1;
  for (const t of thresholds) {
    if (value >= t) score += 1;
    else break;
  }
  return Math.min(5, score);
}

function recencyScore(days: number): number {
  if (!Number.isFinite(days)) return 1;
  if (days <= 30) return 5;
  if (days <= 60) return 4;
  if (days <= 90) return 3;
  if (days <= 180) return 2;
  return 1;
}

/** Churn aproximado solo por recencia observada (sin modelo predictivo local). */
function churnFromRecency(days: number): { risk: number; band: ChurnBand } {
  if (!Number.isFinite(days)) return { risk: 0.95, band: 'high' };
  if (days <= 45) return { risk: 0.1, band: 'low' };
  if (days <= 90) return { risk: 0.35, band: 'low' };
  if (days <= 150) return { risk: 0.55, band: 'medium' };
  if (days <= 240) return { risk: 0.75, band: 'high' };
  return { risk: 0.9, band: 'high' };
}

function classifySegment(
  completedOrders: number,
  totalSpend: number,
  lastOrderAt: string | null,
  vipThreshold: number,
): CustomerSegment {
  const days = daysSince(lastOrderAt);
  if (days > 180) return 'inactive';
  if (days > 90 && completedOrders > 0) return 'at_risk';
  if (totalSpend >= vipThreshold && completedOrders >= 2) return 'vip';
  if (completedOrders >= 2) return 'recurrent';
  if (completedOrders === 1) return 'new';
  return 'inactive';
}

function percentileThresholds(sortedAsc: number[]): [number, number, number, number] {
  if (sortedAsc.length === 0) return [1, 2, 3, 4];
  const at = (p: number) => {
    const idx = Math.min(
      sortedAsc.length - 1,
      Math.max(0, Math.floor(p * (sortedAsc.length - 1))),
    );
    return sortedAsc[idx] ?? 0;
  };
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

type Acc = {
  name: string;
  email: string;
  ordersCount: number;
  completedOrders: number;
  totalSpend: number;
  currency: string;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
  lastCompletedAt: string | null;
  channels: Set<string>;
  eventCounts: Map<string, number>;
};

/**
 * Agrega compradores por correo a partir de OrderRow.
 * Límite: solo pedidos presentes en la respuesta de GET /admin/orders.
 */
export function buildCustomerRows(
  orders: readonly OrderRow[],
  aiByEmail: ReadonlyMap<string, AiCustomerSegmentRow> = new Map(),
): CrmCustomerRow[] {
  const byEmail = new Map<string, Acc>();

  for (const order of orders) {
    const emailKey = order.buyerEmail?.trim().toLowerCase() || 'sin-email';
    const existing = byEmail.get(emailKey);
    const completed = isCompleted(order.status);
    const amount = completed ? parseMoney(order.totalAmount) : 0;
    const eventTitle = order.event?.title?.trim() || 'Sin evento';

    if (!existing) {
      byEmail.set(emailKey, {
        name: order.buyerName?.trim() || 'Cliente sin nombre',
        email: order.buyerEmail?.trim() || 'Sin correo',
        ordersCount: 1,
        completedOrders: completed ? 1 : 0,
        totalSpend: amount,
        currency: order.currency || 'MXN',
        lastOrderAt: order.createdAt,
        firstOrderAt: order.createdAt,
        lastCompletedAt: completed ? order.createdAt : null,
        channels: new Set(order.channel ? [order.channel] : []),
        eventCounts: new Map([[eventTitle, 1]]),
      });
      continue;
    }

    existing.ordersCount += 1;
    if (completed) {
      existing.completedOrders += 1;
      existing.totalSpend += amount;
      const created = new Date(order.createdAt).getTime();
      if (
        !existing.lastCompletedAt ||
        created > new Date(existing.lastCompletedAt).getTime()
      ) {
        existing.lastCompletedAt = order.createdAt;
      }
    }
    if (!existing.name || existing.name === 'Cliente sin nombre') {
      existing.name = order.buyerName?.trim() || existing.name;
    }
    if (order.channel) existing.channels.add(order.channel);
    existing.eventCounts.set(eventTitle, (existing.eventCounts.get(eventTitle) ?? 0) + 1);

    const created = new Date(order.createdAt).getTime();
    if (!existing.lastOrderAt || created > new Date(existing.lastOrderAt).getTime()) {
      existing.lastOrderAt = order.createdAt;
    }
    if (!existing.firstOrderAt || created < new Date(existing.firstOrderAt).getTime()) {
      existing.firstOrderAt = order.createdAt;
    }
  }

  const spends = [...byEmail.values()]
    .map((row) => row.totalSpend)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const freqs = [...byEmail.values()]
    .map((row) => row.completedOrders)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  const spendThresholds = percentileThresholds(spends);
  const freqThresholds = percentileThresholds(freqs);
  const vipThreshold =
    spends.length >= 4
      ? spends[Math.floor(spends.length * 0.9)] ?? spends[spends.length - 1] ?? 0
      : spends[spends.length - 1] ?? 0;

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

      const recencyDays = daysSince(row.lastCompletedAt ?? row.lastOrderAt);
      const rfm: RfmScores = {
        recency: recencyScore(recencyDays),
        frequency: scoreByThresholds(row.completedOrders, freqThresholds),
        monetary: scoreByThresholds(row.totalSpend, spendThresholds),
      };
      const rfmScore = (rfm.recency + rfm.frequency + rfm.monetary) / 3;
      const { risk: churnRisk, band: churnBand } = churnFromRecency(recencyDays);
      const segment = classifySegment(
        row.completedOrders,
        row.totalSpend,
        row.lastCompletedAt ?? row.lastOrderAt,
        vipThreshold,
      );
      const ai = aiByEmail.get(id);
      const channelList = [...row.channels].sort((a, b) => a.localeCompare(b, 'es-MX'));

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
        recencyDays: Number.isFinite(recencyDays) ? recencyDays : 9999,
        channels: channelList.join(', ') || '—',
        channelList,
        topEvent,
        segment,
        rfm,
        rfmScore,
        churnRisk,
        churnBand,
        aiSegment: ai?.segment ?? null,
        aiChurnProbability: ai?.churnProbability ?? null,
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
      description: SEGMENT_DESCRIPTION[id],
      count: members.length,
      spend: members.reduce((sum, row) => sum + row.totalSpend, 0),
      tone: SEGMENT_TONE[id],
    };
  });
}

export function crmKpis(customers: readonly CrmCustomerRow[]): CrmKpis {
  const active = customers.filter((row) => row.segment !== 'inactive');
  const recurrent = customers.filter((row) => row.completedOrders >= 2);
  const frequent = customers.filter((row) => row.completedOrders >= 3);
  const churnHigh = customers.filter((row) => row.churnBand === 'high');
  const spend = customers.reduce((sum, row) => sum + row.totalSpend, 0);
  const avgLtv = customers.length ? spend / customers.length : 0;
  const retention = customers.length ? recurrent.length / customers.length : 0;
  return {
    customers: customers.length,
    active: active.length,
    avgLtv,
    retention,
    spend,
    frequent: frequent.length,
    churnHigh: churnHigh.length,
  };
}

/** Top compradores frecuentes (F ≥ 3 o top N por completedOrders). */
export function frequentBuyers(
  customers: readonly CrmCustomerRow[],
  limit = 8,
): CrmCustomerRow[] {
  return [...customers]
    .filter((row) => row.completedOrders >= 2)
    .sort(
      (a, b) =>
        b.completedOrders - a.completedOrders || b.totalSpend - a.totalSpend,
    )
    .slice(0, limit);
}

/** Clientes con churn band high/medium ordenados por riesgo. */
export function churnRiskCustomers(
  customers: readonly CrmCustomerRow[],
  limit = 8,
): CrmCustomerRow[] {
  return [...customers]
    .filter((row) => row.churnBand !== 'low' && row.completedOrders > 0)
    .sort((a, b) => b.churnRisk - a.churnRisk || b.totalSpend - a.totalSpend)
    .slice(0, limit);
}

export function indexAiByEmail(
  rows: readonly AiCustomerSegmentRow[] | undefined,
): Map<string, AiCustomerSegmentRow> {
  const map = new Map<string, AiCustomerSegmentRow>();
  if (!rows) return map;
  for (const row of rows) {
    const key = row.email?.trim().toLowerCase();
    if (key) map.set(key, row);
  }
  return map;
}
