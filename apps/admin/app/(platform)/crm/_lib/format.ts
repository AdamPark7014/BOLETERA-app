import { formatCurrency, formatNumber, formatPercent } from '@boletera/ui';
import type { CrmRangeKey } from './types';

/** `deltaPercent` de la API viene en puntos (p. ej. 12.5 → +12.5 %). */
export function kpiDeltaRatio(deltaPercent: number | null | undefined): number | undefined {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return undefined;
  return deltaPercent / 100;
}

export function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number, currency = 'MXN'): string {
  if (currency === 'MXN') return formatCurrency(value);
  return `${formatNumber(value, 2)} ${currency}`;
}

export function formatShare(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return formatPercent(ratio, 1);
}

export function formatRfm(scores: {
  recency: number;
  frequency: number;
  monetary: number;
}): string {
  return `R${scores.recency}·F${scores.frequency}·M${scores.monetary}`;
}

export function formatRelativeDay(iso: string | null): string {
  if (!iso) return 'Sin pedidos';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`;
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function daysAgoIso(days: number): string {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - days);
  return value.toISOString();
}

export function rangeLabel(range: CrmRangeKey): string {
  if (range === '30') return 'Últimos 30 días';
  if (range === '90') return 'Últimos 90 días';
  return 'Últimos 12 meses';
}

export function formatChurnPct(risk: number): string {
  if (!Number.isFinite(risk)) return '—';
  return formatPercent(Math.min(1, Math.max(0, risk)), 0);
}

/**
 * Monto de un pedido tal como lo manda `GET /admin/orders`. El tipo `OrderRow`
 * de `lib` dice `totalAmount`, pero el API hoy devuelve `expectedAmount`
 * (y `chargedAmount` cuando ya se cobró). Se lee el primero que exista.
 */
export function orderAmount(order: object): number {
  const row = order as Record<string, unknown>;
  for (const key of ['totalAmount', 'chargedAmount', 'expectedAmount']) {
    const value = row[key];
    if (value != null && value !== '') return parseMoney(value as string | number);
  }
  return 0;
}

export function orderCurrency(order: object): string {
  const row = order as Record<string, unknown>;
  for (const key of ['currency', 'chargedCurrency', 'expectedCurrency']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'MXN';
}
