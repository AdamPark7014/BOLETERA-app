import { formatCurrency, formatNumber, formatPercent } from '@boletera/ui';
import type { RangeKey } from './types';

export function daysAgoIso(days: number): string {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - days);
  return value.toISOString();
}

export function rangeLabel(range: RangeKey): string {
  if (range === '30') return 'Últimos 30 días';
  if (range === '90') return 'Últimos 90 días';
  return 'Últimos 12 meses';
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

export function kpiDeltaRatio(deltaPercent: number | null | undefined): number | undefined {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return undefined;
  return deltaPercent / 100;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatExpiry(iso: string | null): string {
  if (!iso) return 'Sin TTL';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Sin TTL';
  const minutes = Math.floor((date.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return 'Vencido / por liberar';
  if (minutes < 60) return `Expira en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Expira en ${hours} h`;
}

export function isRangeKey(value: string): value is RangeKey {
  return value === '30' || value === '90' || value === '365';
}
