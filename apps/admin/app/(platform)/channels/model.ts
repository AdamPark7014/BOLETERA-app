import type { BadgeTone } from '@boletera/ui';
import type { MetricsGranularity, SalesChannel } from '@boletera/shared';
import type { ChannelConfiguration } from '@/lib/queries';
import { CHANNEL_LABELS as SALES_CHANNEL_LABELS } from '../orders/_lib/format';

// ---------------------------------------------------------------- rango

export type RangeKey = '7d' | '30d' | '90d';

export type RangeWindow = {
  key: RangeKey;
  label: string;
  from: string;
  to: string;
  granularity: MetricsGranularity;
  comparisonLabel: string;
};

const RANGE_META: Record<
  RangeKey,
  { label: string; days: number; granularity: MetricsGranularity; comparisonLabel: string }
> = {
  '7d': { label: '7 días', days: 7, granularity: 'day', comparisonLabel: 'vs. 7 días previos' },
  '30d': { label: '30 días', days: 30, granularity: 'day', comparisonLabel: 'vs. 30 días previos' },
  '90d': { label: '90 días', days: 90, granularity: 'week', comparisonLabel: 'vs. 90 días previos' },
};

export const RANGE_KEYS: readonly RangeKey[] = ['7d', '30d', '90d'];

export function buildRange(key: RangeKey, now = new Date()): RangeWindow {
  const meta = RANGE_META[key];
  const from = new Date(now.getTime() - meta.days * 24 * 60 * 60 * 1000);
  return {
    key,
    label: meta.label,
    from: from.toISOString(),
    to: now.toISOString(),
    granularity: meta.granularity,
    comparisonLabel: meta.comparisonLabel,
  };
}

// ------------------------------------------------------------- formatos

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

export function formatMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ms`;
}

export function formatSeconds(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} s`;
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

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: 'numeric',
    month: 'short',
  });
}

// --------------------------------------------------- lectura defensiva

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ------------------------------------------------------------- canales

export const CHANNEL_ORDER = [
  'web',
  'taquilla',
  'api',
  'admin',
  'promoter',
  'courtesy',
  'corporate',
  'mobile',
  'phone',
  'invitation',
  'affiliate',
  'vip',
  'resale',
] as const;

export type ChannelKey = (typeof CHANNEL_ORDER)[number];

/** Channels that accept a free-text responsible party in the admin UI. */
export const RESPONSIBLE_PARTY_CHANNELS: readonly ChannelKey[] = [
  'taquilla',
  'api',
  'admin',
  'promoter',
  'corporate',
  'affiliate',
  'vip',
  'invitation',
];

export type ChannelHealthStatus = 'healthy' | 'degraded' | 'down' | 'disabled' | 'unknown';

export type ChannelHealthCard = {
  key: ChannelKey;
  label: string;
  status: ChannelHealthStatus;
  orders: number;
  revenue: number;
  errorRate: number | null;
  latencyMs: number | null;
  syncLagSec: number | null;
  activeTerminals: number | null;
  activePartners: number | null;
  rateLimitUsage: number | null;
  held: number | null;
  sold: number | null;
};

export function channelLabel(key: string): string {
  const upper = key.toUpperCase() as SalesChannel;
  if (upper in SALES_CHANNEL_LABELS) return SALES_CHANNEL_LABELS[upper];
  return key;
}

function toHealthStatus(value: string | null): ChannelHealthStatus {
  const lower = (value ?? '').toLowerCase();
  if (lower === 'disabled') return 'disabled';
  if (lower === 'healthy' || lower === 'ok' || lower === 'up') return 'healthy';
  if (lower === 'degraded' || lower === 'warn' || lower === 'warning') return 'degraded';
  if (lower === 'down' || lower === 'error' || lower === 'critical') return 'down';
  return 'unknown';
}

export function healthStatusMeta(status: ChannelHealthStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case 'healthy':
      return { label: 'Saludable', tone: 'success' };
    case 'degraded':
      return { label: 'Degradado', tone: 'warning' };
    case 'down':
      return { label: 'Caído', tone: 'danger' };
    case 'disabled':
      return { label: 'Desactivado', tone: 'neutral' };
    default:
      return { label: 'Sin datos', tone: 'neutral' };
  }
}

function parseHealthCard(key: ChannelKey, raw: unknown): ChannelHealthCard {
  const record = asRecord(raw);
  return {
    key,
    label: channelLabel(key),
    status: toHealthStatus(readString(record, 'status')),
    orders: readNumber(record, 'orders') ?? 0,
    revenue: readNumber(record, 'revenue') ?? 0,
    errorRate: readNumber(record, 'errorRate'),
    latencyMs: readNumber(record, 'responseTimeMs'),
    syncLagSec: readNumber(record, 'syncLagSec'),
    activeTerminals: readNumber(record, 'activeTerminals'),
    activePartners: readNumber(record, 'activePartners'),
    rateLimitUsage: readNumber(record, 'rateLimitUsage'),
    held: readNumber(record, 'held'),
    sold: readNumber(record, 'sold'),
  };
}

/** Normaliza el mapa de salud del backend a tarjetas estables para la UI. */
export function parseChannelHealth(value: unknown): ChannelHealthCard[] {
  const record = asRecord(value);
  const cards: ChannelHealthCard[] = [];

  for (const key of CHANNEL_ORDER) {
    const raw = record[key] ?? record[key.toUpperCase()];
    if (raw === undefined) {
      cards.push({
        key,
        label: channelLabel(key),
        status: 'unknown',
        orders: 0,
        revenue: 0,
        errorRate: null,
        latencyMs: null,
        syncLagSec: null,
        activeTerminals: null,
        activePartners: null,
        rateLimitUsage: null,
        held: null,
        sold: null,
      });
      continue;
    }
    cards.push(parseHealthCard(key, raw));
  }

  return cards;
}

export type HealthSummary = {
  healthy: number;
  degraded: number;
  down: number;
  totalOrders: number;
  totalRevenue: number;
  worstErrorRate: number | null;
  worstLatencyMs: number | null;
};

export function summarizeHealth(cards: readonly ChannelHealthCard[]): HealthSummary {
  let worstErrorRate: number | null = null;
  let worstLatencyMs: number | null = null;
  for (const card of cards) {
    if (card.errorRate !== null) {
      worstErrorRate =
        worstErrorRate === null ? card.errorRate : Math.max(worstErrorRate, card.errorRate);
    }
    if (card.latencyMs !== null) {
      worstLatencyMs =
        worstLatencyMs === null ? card.latencyMs : Math.max(worstLatencyMs, card.latencyMs);
    }
  }
  return {
    healthy: cards.filter((card) => card.status === 'healthy').length,
    degraded: cards.filter((card) => card.status === 'degraded').length,
    down: cards.filter((card) => card.status === 'down').length,
    totalOrders: cards.reduce((sum, card) => sum + card.orders, 0),
    totalRevenue: cards.reduce((sum, card) => sum + card.revenue, 0),
    worstErrorRate,
    worstLatencyMs,
  };
}

// ------------------------------------------------------ configuración

export type ChannelFormEntry = {
  allocation: number;
  enabled: boolean;
  responsibleParty: string;
  locations: string[];
};

export type AllocationForm = Record<ChannelKey, ChannelFormEntry>;

const DEFAULT_CHANNEL_ENTRY: ChannelFormEntry = {
  allocation: 0,
  enabled: false,
  responsibleParty: '',
  locations: [],
};

export const DEFAULT_ALLOCATION: AllocationForm = CHANNEL_ORDER.reduce((acc, key) => {
  acc[key] = { ...DEFAULT_CHANNEL_ENTRY };
  return acc;
}, {} as AllocationForm);

DEFAULT_ALLOCATION.web = { allocation: 50, enabled: true, responsibleParty: '', locations: [] };
DEFAULT_ALLOCATION.taquilla = { allocation: 35, enabled: true, responsibleParty: '', locations: [] };
DEFAULT_ALLOCATION.api = { allocation: 15, enabled: true, responsibleParty: '', locations: [] };

function parseChannelEntry(
  raw: unknown,
  fallback: ChannelFormEntry,
): ChannelFormEntry {
  const record = asRecord(raw);
  return {
    allocation: readNumber(record, 'allocation') ?? fallback.allocation,
    enabled: readBoolean(record, 'enabled') ?? fallback.enabled,
    responsibleParty: readString(record, 'responsibleParty') ?? fallback.responsibleParty,
    locations: readStringArray(record, 'locations').length
      ? readStringArray(record, 'locations')
      : fallback.locations,
  };
}

export function parseAllocationFromMetadata(
  metadata: Record<string, unknown> | undefined,
): AllocationForm {
  const channels = asRecord(metadata?.channels);
  const form = {} as AllocationForm;

  for (const key of CHANNEL_ORDER) {
    const fallback = DEFAULT_ALLOCATION[key];
    form[key] = parseChannelEntry(channels[key], fallback);
  }

  return form;
}

export function allocationTotal(form: AllocationForm): number {
  return CHANNEL_ORDER.reduce((sum, key) => {
    const entry = form[key];
    return entry.enabled ? sum + entry.allocation : sum;
  }, 0);
}

export function toChannelConfiguration(form: AllocationForm): ChannelConfiguration {
  const config: ChannelConfiguration = {};
  for (const key of CHANNEL_ORDER) {
    const entry = form[key];
    config[key] = {
      enabled: entry.enabled,
      allocation: entry.enabled ? entry.allocation : 0,
      ...(entry.responsibleParty.trim()
        ? { responsibleParty: entry.responsibleParty.trim() }
        : {}),
      ...(key === 'taquilla' && entry.locations.length ? { locations: entry.locations } : {}),
    };
  }
  return config;
}

export type AllocationIssue =
  | { kind: 'total'; message: string }
  | { kind: 'disabled'; message: string }
  | null;

export function validateAllocation(form: AllocationForm): AllocationIssue {
  const enabledCount = CHANNEL_ORDER.filter((key) => form[key].enabled).length;
  if (enabledCount === 0) {
    return {
      kind: 'disabled',
      message: 'Debes dejar al menos un canal habilitado.',
    };
  }

  const total = allocationTotal(form);
  if (total !== 100) {
    return {
      kind: 'total',
      message: `La suma de canales habilitados debe ser 100 %. Ahora suma ${total} %.`,
    };
  }

  return null;
}

export function responsiblePartyLabel(key: ChannelKey): string {
  switch (key) {
    case 'taquilla':
      return 'Ubicaciones / operador';
    case 'api':
      return 'Partner API';
    case 'promoter':
      return 'Promotor responsable';
    case 'affiliate':
      return 'Afiliado';
    case 'corporate':
      return 'Cuenta corporativa';
    case 'admin':
      return 'Operador admin';
    case 'vip':
      return 'Contacto VIP';
    case 'invitation':
      return 'Organizador invitaciones';
    default:
      return 'Responsable';
  }
}

// ------------------------------------------------------ mix ingresos

export type RevenueSlice = {
  id: string;
  label: string;
  value: number;
  orders: number;
  percent: number;
};

export function buildRevenueMix(
  rows: ReadonlyArray<{
    key: string;
    label: string;
    value: number;
    secondaryValue?: number;
    percentOfTotal?: number;
  }>,
  total: number,
): RevenueSlice[] {
  return rows
    .map((row) => ({
      id: row.key,
      label: row.label || channelLabel(row.key),
      value: row.value,
      orders: typeof row.secondaryValue === 'number' ? row.secondaryValue : 0,
      percent:
        row.percentOfTotal ??
        (total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0),
    }))
    .sort((a, b) => b.value - a.value);
}

// ------------------------------------------------------------- alertas

export type ChannelAlertSeverity = 'critical' | 'warning' | 'info';

export type ChannelAlert = {
  id: string;
  severity: ChannelAlertSeverity;
  title: string;
  explanation: string;
  suggestion: string;
};

const SEVERITY_ORDER: Record<ChannelAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function severityMeta(severity: ChannelAlertSeverity): {
  label: string;
  tone: BadgeTone;
} {
  switch (severity) {
    case 'critical':
      return { label: 'Crítica', tone: 'danger' };
    case 'warning':
      return { label: 'Atención', tone: 'warning' };
    default:
      return { label: 'Info', tone: 'info' };
  }
}

export function buildChannelAlerts(
  cards: readonly ChannelHealthCard[],
  mix: readonly RevenueSlice[],
  allocation: AllocationForm,
  allocationIssue: AllocationIssue,
): ChannelAlert[] {
  const list: ChannelAlert[] = [];

  for (const card of cards) {
    if (card.status === 'down') {
      list.push({
        id: `down-${card.key}`,
        severity: 'critical',
        title: `${card.label} está caído`,
        explanation: 'El canal no reporta estado saludable y puede estar bloqueando ventas.',
        suggestion: 'Revisa conectividad, colas y reintentos antes de reasignar inventario.',
      });
    } else if (card.status === 'degraded') {
      list.push({
        id: `degraded-${card.key}`,
        severity: 'warning',
        title: `${card.label} opera degradado`,
        explanation: 'Hay señales de latencia o errores por encima del umbral habitual.',
        suggestion: 'Monitorea el error rate y considera bajar la asignación temporalmente.',
      });
    }

    if (card.errorRate !== null && card.errorRate >= 0.05) {
      list.push({
        id: `errors-${card.key}`,
        severity: card.errorRate >= 0.1 ? 'critical' : 'warning',
        title: `Errores elevados en ${card.label}`,
        explanation: `La tasa de error actual es ${formatPercentPoints(card.errorRate * 100)}.`,
        suggestion: 'Inspecciona logs y circuit breakers antes de aumentar tráfico.',
      });
    }

    if (card.latencyMs !== null && card.latencyMs >= 800) {
      list.push({
        id: `latency-${card.key}`,
        severity: card.latencyMs >= 1500 ? 'critical' : 'warning',
        title: `Latencia alta en ${card.label}`,
        explanation: `Respuesta media de ${formatMs(card.latencyMs)}.`,
        suggestion: 'Revisa el origen (CDN, API o terminales POS) y el tamaño de inventario.',
      });
    }

    if (card.key === 'taquilla' && card.syncLagSec !== null && card.syncLagSec >= 30) {
      list.push({
        id: 'taquilla-lag',
        severity: 'warning',
        title: 'Taquilla con retraso de sincronización',
        explanation: `El lag de sync es ${formatSeconds(card.syncLagSec)}.`,
        suggestion: 'Verifica conectividad de terminales y la cola de asientos.',
      });
    }

    if (card.key === 'api' && card.rateLimitUsage !== null && card.rateLimitUsage >= 80) {
      list.push({
        id: 'api-rate',
        severity: 'warning',
        title: 'Partners cerca del rate limit',
        explanation: `Uso de rate limit al ${formatPercentPoints(card.rateLimitUsage)}.`,
        suggestion: 'Ajusta cupos por partner o escala el límite contractual.',
      });
    }
  }

  if (allocationIssue?.kind === 'total') {
    list.push({
      id: 'allocation-total',
      severity: 'critical',
      title: 'Asignación incompleta',
      explanation: allocationIssue.message,
      suggestion: 'Ajusta los porcentajes hasta sumar exactamente 100 % antes de guardar.',
    });
  }

  const webMix = mix.find((slice) => slice.id.toUpperCase() === 'WEB');
  const webAllocation = allocation.web?.allocation ?? 0;
  if (webMix && webMix.percent < 20 && webAllocation >= 50) {
    list.push({
      id: 'web-underused',
      severity: 'info',
      title: 'Web tiene mucha asignación y poco ingreso',
      explanation: `Asignaste ${webAllocation} % a web pero solo genera ${formatPercentPoints(
        webMix.percent,
      )} del ingreso del periodo.`,
      suggestion: 'Considera mover cupo a POS o partners si el ritmo web no recupera.',
    });
  }

  if (cards.length === 0) {
    list.push({
      id: 'no-health',
      severity: 'info',
      title: 'Sin telemetría de canales',
      explanation: 'El evento aún no reporta salud en tiempo real.',
      suggestion: 'Configura la asignación y genera órdenes de prueba para poblar el panel.',
    });
  }

  return list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
