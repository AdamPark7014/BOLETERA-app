import { formatCurrency, formatNumber, formatPercent } from '@boletera/ui';

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

export function formatCount(value: number): string {
  return formatNumber(value);
}

export function formatShare(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return formatPercent(ratio, 1);
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
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysAgoIso(days: number): string {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - days);
  return value.toISOString();
}

export function rangeLabel(range: '30' | '90' | '365'): string {
  if (range === '30') return 'Últimos 30 días';
  if (range === '90') return 'Últimos 90 días';
  return 'Últimos 12 meses';
}
