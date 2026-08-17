import type { MetricsRangeKey, SettlementPeriod } from './types';

export const RANGE_OPTIONS: ReadonlyArray<{
  value: MetricsRangeKey;
  label: string;
  days: number;
}> = [
  { value: '7d', label: '7 días', days: 7 },
  { value: '30d', label: '30 días', days: 30 },
  { value: '90d', label: '90 días', days: 90 },
];

export const SETTLEMENT_OPTIONS: ReadonlyArray<{
  value: SettlementPeriod;
  label: string;
}> = [
  { value: 'DAILY', label: 'Diaria' },
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'MONTHLY', label: 'Mensual' },
];

export function isMetricsRangeKey(value: string): value is MetricsRangeKey {
  return value === '7d' || value === '30d' || value === '90d';
}

export function isSettlementPeriod(value: string): value is SettlementPeriod {
  return value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY';
}

export function metricsRangeIso(range: MetricsRangeKey): { from: string; to: string } {
  const days = RANGE_OPTIONS.find((o) => o.value === range)?.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function money(amount: string | number | null | undefined, currency = 'MXN'): string {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: digits })} %`;
}

export function formatKpiValue(
  value: number,
  unit: 'mxn' | 'count' | 'percent' | 'ratio' | undefined,
): string {
  if (unit === 'mxn') return money(value);
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'ratio') {
    return value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }
  return formatCount(value);
}

export function kpiDeltaRatio(deltaPercent: number | null | undefined): number | undefined {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return undefined;
  return deltaPercent / 100;
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

export function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    WEB: 'Web',
    TAQUILLA: 'Taquilla',
    POS: 'POS',
    API: 'API',
    ADMIN: 'Admin',
    RESALE: 'Reventa',
  };
  return map[channel] ?? channel;
}

export function paceRiskLabel(
  risk: 'on_track' | 'watch' | 'at_risk' | 'critical',
): string {
  switch (risk) {
    case 'on_track':
      return 'En ritmo';
    case 'watch':
      return 'Observar';
    case 'at_risk':
      return 'En riesgo';
    case 'critical':
      return 'Crítico';
  }
}

export function paceRiskTone(
  risk: 'on_track' | 'watch' | 'at_risk' | 'critical',
): 'success' | 'info' | 'warning' | 'danger' {
  switch (risk) {
    case 'on_track':
      return 'success';
    case 'watch':
      return 'info';
    case 'at_risk':
      return 'warning';
    case 'critical':
      return 'danger';
  }
}

export function zReportTotal(report: unknown): number {
  if (!report || typeof report !== 'object') return 0;
  const record = report as Record<string, unknown>;
  const raw = record.totalRevenue ?? record.total ?? record.gross;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}
