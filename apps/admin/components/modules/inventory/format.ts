import { formatNumber, formatPercent } from '@boletera/ui';

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

export function formatCount(value: number): string {
  return formatNumber(value);
}

export function formatAvailability(percent: number): string {
  if (!Number.isFinite(percent)) return '—';
  // API envía 0–100 en availabilityPercent.
  return `${formatNumber(percent, 1)} %`;
}

export function formatVelocity(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, 1)} / día`;
}

export function formatDaysToSellOut(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Sin ritmo';
  if (value < 1) return '< 1 día';
  return `${formatNumber(value, 0)} días`;
}

export function formatOccupancyRatio(sold: number, total: number): string {
  if (!total) return formatPercent(0, 1);
  return formatPercent(sold / total, 1);
}
