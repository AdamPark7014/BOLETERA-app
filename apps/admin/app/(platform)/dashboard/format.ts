import type { MetricsAlertSeverity, MetricsGranularity, MetricsKpi } from '@boletera/shared';

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const COUNT = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

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

export function formatCount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return COUNT.format(value);
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

function formatDayShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: 'numeric',
    month: 'short',
  });
}

function formatHourShort(iso: string): string {
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

/** Copia local de las etiquetas de canal: el tablero no depende de la carpeta de órdenes. */
const CHANNEL_LABELS: Record<string, string> = {
  WEB: 'Web',
  TAQUILLA: 'Taquilla',
  API: 'API',
  ADMIN: 'Admin',
  PROMOTER: 'Promotor',
  COURTESY: 'Cortesía',
  CORPORATE: 'Corporativo',
  MOBILE: 'App móvil',
  PHONE: 'Teléfono',
  INVITATION: 'Invitación',
  AFFILIATE: 'Afiliado',
  VIP: 'VIP',
  RESALE: 'Reventa',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? CHANNEL_LABELS[channel.toUpperCase()] ?? channel;
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
