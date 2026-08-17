import type { BadgeTone } from '@boletera/ui';
import type { MetricsAlertSeverity } from '@boletera/shared';

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const COUNT = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

const RELATIVE = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

export function formatMxn(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return MXN.format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return COUNT.format(value);
}

export function formatPercentPoints(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
}

export function formatRatioPercent(ratio: number | null | undefined): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '—';
  return formatPercentPoints(ratio * 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  });
}

export function formatDayShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: 'numeric',
    month: 'short',
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(diffSec, 'second');
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return RELATIVE.format(Math.round(diffSec / 3600), 'hour');
  return RELATIVE.format(Math.round(diffSec / 86_400), 'day');
}

export function statusTone(status: string): BadgeTone {
  const normalized = status.toUpperCase();
  if (['PUBLISHED', 'ON_SALE', 'LIVE', 'ACTIVE', 'COMPLETED', 'PAID'].includes(normalized)) {
    return 'success';
  }
  if (['DRAFT', 'ANNOUNCED', 'SCHEDULED', 'PENDING', 'HELD'].includes(normalized)) {
    return 'warning';
  }
  if (['CANCELLED', 'FAILED', 'CRITICAL', 'BLOCKED'].includes(normalized)) {
    return 'danger';
  }
  return 'neutral';
}

export function riskTone(level: string): BadgeTone {
  switch (level) {
    case 'on_track':
      return 'success';
    case 'watch':
      return 'warning';
    case 'at_risk':
    case 'critical':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function riskLabel(level: string): string {
  switch (level) {
    case 'on_track':
      return 'En ritmo';
    case 'watch':
      return 'Observar';
    case 'at_risk':
      return 'En riesgo';
    case 'critical':
      return 'Crítico';
    default:
      return level;
  }
}

export function severityTone(severity: MetricsAlertSeverity): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

export function severityLabel(severity: MetricsAlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Crítica';
    case 'warning':
      return 'Atención';
    case 'info':
      return 'Info';
    default:
      return severity;
  }
}

export function channelLabel(key: string): string {
  const map: Record<string, string> = {
    WEB: 'Web',
    web: 'Web',
    TAQUILLA: 'Taquilla',
    taquilla: 'Taquilla',
    API: 'API',
    api: 'API',
    ADMIN: 'Admin',
    RESALE: 'Reventa',
    PHONE: 'Teléfono',
  };
  return map[key] ?? key;
}

export function healthTone(status: string | undefined): BadgeTone {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'ok' || normalized === 'up') return 'success';
  if (normalized === 'degraded' || normalized === 'warn' || normalized === 'warning') {
    return 'warning';
  }
  if (normalized === 'down' || normalized === 'error' || normalized === 'critical') {
    return 'danger';
  }
  return 'neutral';
}
