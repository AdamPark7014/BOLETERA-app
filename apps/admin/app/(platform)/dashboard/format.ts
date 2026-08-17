import type { MetricsAlertSeverity, MetricsGranularity, MetricsKpi } from '@boletera/shared';

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const MXN_COMPACT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const COUNT = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

const COUNT_COMPACT = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const PERCENT = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

const RELATIVE = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

export function formatMxn(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return MXN.format(value);
}

export function formatMxnCompact(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return MXN_COMPACT.format(value);
}

export function formatCount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return COUNT.format(value);
}

export function formatCountCompact(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return COUNT_COMPACT.format(value);
}

export function formatPercentPoints(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
}

/** `deltaPercent` de la API ya viene en puntos porcentuales (p. ej. 12.5). */
export function formatDeltaPercent(deltaPercent: number | null | undefined): string {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return 'sin base';
  return PERCENT.format(deltaPercent / 100);
}

/**
 * Convierte los puntos porcentuales de la API en la razón que esperan
 * `TrendPill` y `KpiCard` (12.5 → 0.125). `undefined` cuando no hay base
 * comparable, para que el componente muestre su estado neutro.
 */
export function toDeltaRatio(deltaPercent: number | null | undefined): number | undefined {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return undefined;
  return deltaPercent / 100;
}

export function formatKpiScalar(unit: MetricsKpi['unit'], value: number): string {
  switch (unit) {
    case 'mxn':
      return formatMxn(value);
    case 'percent':
      return formatPercentPoints(value);
    case 'ratio':
      return value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
    default:
      return formatCount(value);
  }
}

export function formatKpiValue(kpi: MetricsKpi): string {
  return formatKpiScalar(kpi.unit, kpi.value);
}

export function deltaTone(
  deltaPercent: number | null | undefined,
  invert = false,
): 'up' | 'down' | 'flat' {
  if (deltaPercent == null || Math.abs(deltaPercent) < 0.05) return 'flat';
  const positive = deltaPercent > 0;
  if (invert) return positive ? 'down' : 'up';
  return positive ? 'up' : 'down';
}

export function formatRelative(iso: string | undefined | null): string {
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

export function formatDayShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: 'numeric',
    month: 'short',
  });
}

export function formatHourShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Etiqueta de un bucket de serie, acorde a la granularidad del rango. */
export function formatBucket(iso: string, granularity: MetricsGranularity): string {
  if (granularity === 'hour') return formatHourShort(iso);
  if (granularity === 'month') {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      month: 'short',
      year: '2-digit',
    });
  }
  return formatDayShort(iso);
}

export function severityTone(
  severity: MetricsAlertSeverity,
): 'neutral' | 'info' | 'warning' | 'danger' {
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

export function riskTone(level: string): 'success' | 'warning' | 'danger' | 'neutral' {
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

export function channelLabel(key: string): string {
  const map: Record<string, string> = {
    WEB: 'Web',
    TAQUILLA: 'Taquilla POS',
    API: 'API',
    ADMIN: 'Admin',
    RESALE: 'Reventa',
  };
  return map[key] ?? key;
}

export function orderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    COMPLETED: 'Completada',
    PENDING: 'Pendiente',
    FAILED: 'Fallida',
    CANCELLED: 'Cancelada',
    REFUNDED: 'Reembolsada',
    EXPIRED: 'Expirada',
  };
  return map[status] ?? status;
}

export function orderStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function alertHref(entityType?: string, entityId?: string): string | null {
  if (!entityId) {
    if (entityType === 'fraud' || !entityType) return null;
  }
  switch (entityType) {
    case 'event':
      return entityId ? `/events/${entityId}` : '/events';
    case 'offer':
      return '/events';
    case 'promotion':
      return '/campaigns';
    case 'fraud':
      return '/fraud';
    case 'order':
      return entityId ? `/orders/${entityId}` : '/orders';
    default:
      return null;
  }
}

/** Mensaje legible de cualquier error de red o de la API. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
