import type { BadgeTone } from '@boletera/ui';
import type { MetricsGranularity } from '@boletera/shared';
import type { Campaign } from '@/lib/queries';

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

/** El backend entrega porcentajes ya en puntos (12.5 = 12.5 %). */
export function formatPercentPoints(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
}

export function formatRatio(value: number | null | undefined, suffix = '×'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', { maximumFractionDigits: 2 })}${suffix}`;
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

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
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

/** Valor para `<input type="datetime-local">` en hora local del navegador. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
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

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ------------------------------------------------------------- campañas

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export type CampaignView = {
  id: string;
  name: string;
  type: string;
  status: CampaignStatus;
  allocation: number;
  redeemed: number;
  remaining: number;
  redemptionRate: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  quantityPerUser: number | null;
  startsAt: string | null;
  endsAt: string | null;
  codes: string[];
  /** La campaña está publicada y dentro de su ventana. */
  live: boolean;
  /** Ventana vencida sin cerrar. */
  overdue: boolean;
  hoursToStart: number | null;
};

const STATUSES = new Set<CampaignStatus>(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']);

function toStatus(value: string | null): CampaignStatus {
  const upper = (value ?? 'DRAFT').toUpperCase();
  return STATUSES.has(upper as CampaignStatus) ? (upper as CampaignStatus) : 'DRAFT';
}

/**
 * El endpoint de campañas devuelve más campos de los que declara el hook
 * (ventana, tipo de descuento, cupo por usuario). Se leen de forma defensiva
 * para no perder información ni asumir estructura.
 */
export function toCampaignView(raw: Campaign, now = new Date()): CampaignView {
  const record = asRecord(raw);
  const allocation = readNumber(record, 'allocation') ?? 0;
  const redeemed = readNumber(record, 'redeemed') ?? 0;
  const startsAt = readString(record, 'startsAt');
  const endsAt = readString(record, 'endsAt');
  const status = toStatus(readString(record, 'status'));
  const startTime = startsAt ? new Date(startsAt).getTime() : Number.NaN;
  const endTime = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  const nowTime = now.getTime();
  const discountType = readString(record, 'discountType') === 'fixed' ? 'fixed' : 'percentage';

  return {
    id: readString(record, 'id') ?? '',
    name: readString(record, 'name') ?? 'Campaña sin nombre',
    type: readString(record, 'type') ?? 'presale',
    status,
    allocation,
    redeemed,
    remaining: Math.max(0, allocation - redeemed),
    redemptionRate: allocation > 0 ? (redeemed / allocation) * 100 : 0,
    discountType,
    discountValue: readNumber(record, 'discountValue') ?? 0,
    quantityPerUser: readNumber(record, 'quantityPerUser'),
    startsAt,
    endsAt,
    codes: readStringArray(record, 'codes'),
    live:
      status === 'ACTIVE' &&
      (Number.isNaN(startTime) || startTime <= nowTime) &&
      (Number.isNaN(endTime) || endTime >= nowTime),
    overdue: status === 'ACTIVE' && !Number.isNaN(endTime) && endTime < nowTime,
    hoursToStart: Number.isNaN(startTime) ? null : (startTime - nowTime) / 3_600_000,
  };
}

const TYPE_LABELS: Record<string, string> = {
  presale: 'Preventa',
  early_bird: 'Early bird',
  vip: 'VIP',
  group: 'Grupal',
  loyalty: 'Lealtad',
};

export function campaignTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replaceAll('_', ' ');
}

export function campaignStatusMeta(status: CampaignStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Activa', tone: 'success' };
    case 'PAUSED':
      return { label: 'Pausada', tone: 'warning' };
    case 'ENDED':
      return { label: 'Finalizada', tone: 'neutral' };
    default:
      return { label: 'Borrador', tone: 'info' };
  }
}

export function discountLabel(campaign: CampaignView): string {
  return campaign.discountType === 'fixed'
    ? formatMxn(campaign.discountValue)
    : `${campaign.discountValue.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
}

// -------------------------------------------------- analítica por campaña

export type CampaignAnalytics = {
  campaignId: string;
  name: string;
  status: string;
  allocation: number;
  redeemed: number;
  remaining: number;
  redemptionRate: number;
  startDate: string | null;
  endDate: string | null;
};

export function parseCampaignAnalytics(value: unknown): CampaignAnalytics | null {
  const record = asRecord(value);
  const campaignId = readString(record, 'campaignId');
  if (!campaignId) return null;
  const stats = asRecord(record.stats);
  const period = asRecord(record.period);
  return {
    campaignId,
    name: readString(record, 'name') ?? 'Campaña',
    status: readString(record, 'status') ?? 'DRAFT',
    allocation: readNumber(stats, 'allocation') ?? 0,
    redeemed: readNumber(stats, 'redeemed') ?? 0,
    remaining: readNumber(stats, 'remaining') ?? 0,
    redemptionRate: readNumber(stats, 'redemptionRate') ?? 0,
    startDate: readString(period, 'startDate'),
    endDate: readString(period, 'endDate'),
  };
}

// --------------------------------------------------------- KPIs de cupo

export type AllocationSummary = {
  allocation: number;
  redeemed: number;
  remaining: number;
  redemptionRate: number;
  activeCount: number;
  draftCount: number;
  codesIssued: number;
};

export function summarizeAllocation(campaigns: readonly CampaignView[]): AllocationSummary {
  const allocation = campaigns.reduce((sum, item) => sum + item.allocation, 0);
  const redeemed = campaigns.reduce((sum, item) => sum + item.redeemed, 0);
  return {
    allocation,
    redeemed,
    remaining: Math.max(0, allocation - redeemed),
    redemptionRate: allocation > 0 ? (redeemed / allocation) * 100 : 0,
    activeCount: campaigns.filter((item) => item.status === 'ACTIVE').length,
    draftCount: campaigns.filter((item) => item.status === 'DRAFT').length,
    codesIssued: campaigns.reduce((sum, item) => sum + item.codes.length, 0),
  };
}

// -------------------------------------------------------------- ROAS

export type RevenueSummary = {
  revenueAttributed: number;
  discountGiven: number;
  ordersAttributed: number;
  /** Ingreso atribuido por cada peso de descuento otorgado. */
  roas: number | null;
  averageConversion: number | null;
};

export function summarizeRevenue(
  promotions: ReadonlyArray<{
    revenueAttributed: number;
    discountGiven: number;
    ordersAttributed: number;
    conversionRate: number;
  }>,
): RevenueSummary {
  const revenueAttributed = promotions.reduce((sum, item) => sum + item.revenueAttributed, 0);
  const discountGiven = promotions.reduce((sum, item) => sum + item.discountGiven, 0);
  const ordersAttributed = promotions.reduce((sum, item) => sum + item.ordersAttributed, 0);
  const conversions = promotions.filter((item) => Number.isFinite(item.conversionRate));
  return {
    revenueAttributed,
    discountGiven,
    ordersAttributed,
    roas: discountGiven > 0 ? revenueAttributed / discountGiven : null,
    averageConversion: conversions.length
      ? conversions.reduce((sum, item) => sum + item.conversionRate, 0) / conversions.length
      : null,
  };
}

export function performanceMeta(performance: string): { label: string; tone: BadgeTone } {
  switch (performance) {
    case 'strong':
      return { label: 'Fuerte', tone: 'success' };
    case 'poor':
      return { label: 'Débil', tone: 'danger' };
    default:
      return { label: 'Media', tone: 'neutral' };
  }
}

// ------------------------------------------------------------ calendario

export type CalendarBar = {
  id: string;
  name: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  offsetPercent: number;
  widthPercent: number;
  live: boolean;
};

export type CalendarModel = {
  from: string;
  to: string;
  bars: CalendarBar[];
  ticks: Array<{ iso: string; percent: number }>;
  todayPercent: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildCalendar(
  campaigns: readonly CampaignView[],
  now = new Date(),
): CalendarModel | null {
  const scheduled = campaigns.filter(
    (item): item is CampaignView & { startsAt: string; endsAt: string } =>
      Boolean(item.startsAt && item.endsAt),
  );
  if (scheduled.length === 0) return null;

  const starts = scheduled.map((item) => new Date(item.startsAt).getTime());
  const ends = scheduled.map((item) => new Date(item.endsAt).getTime());
  if (starts.some(Number.isNaN) || ends.some(Number.isNaN)) return null;

  const rawFrom = Math.min(...starts, now.getTime());
  const rawTo = Math.max(...ends, now.getTime());
  const padding = Math.max(DAY_MS, (rawTo - rawFrom) * 0.04);
  const from = rawFrom - padding;
  const to = rawTo + padding;
  const span = to - from || DAY_MS;

  const bars = scheduled.map((item) => {
    const start = new Date(item.startsAt).getTime();
    const end = new Date(item.endsAt).getTime();
    const offsetPercent = ((start - from) / span) * 100;
    const widthPercent = Math.max(1.5, ((end - start) / span) * 100);
    return {
      id: item.id,
      name: item.name,
      status: item.status,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      offsetPercent: Math.min(98.5, Math.max(0, offsetPercent)),
      widthPercent: Math.min(100 - Math.max(0, offsetPercent), widthPercent),
      live: item.live,
    };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    iso: new Date(from + span * fraction).toISOString(),
    percent: fraction * 100,
  }));

  const nowPercent = ((now.getTime() - from) / span) * 100;

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bars: bars.sort((a, b) => a.offsetPercent - b.offsetPercent),
    ticks,
    todayPercent: nowPercent >= 0 && nowPercent <= 100 ? nowPercent : null,
  };
}

// ------------------------------------------------------- recomendaciones

export type RecommendationSeverity = 'critical' | 'warning' | 'info';

export type RecommendationAction =
  | { kind: 'publish'; campaignId: string; label: string }
  | { kind: 'export'; campaignId: string; label: string }
  | { kind: 'compose'; label: string };

export type Recommendation = {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  explanation: string;
  suggestion: string;
  action?: RecommendationAction;
};

const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function severityMeta(severity: RecommendationSeverity): {
  label: string;
  tone: BadgeTone;
} {
  switch (severity) {
    case 'critical':
      return { label: 'Crítica', tone: 'danger' };
    case 'warning':
      return { label: 'Atención', tone: 'warning' };
    default:
      return { label: 'Oportunidad', tone: 'info' };
  }
}

export function buildRecommendations(
  campaigns: readonly CampaignView[],
  promotions: ReadonlyArray<{
    promotionId: string;
    name: string;
    code: string;
    performance: string;
    conversionRate: number;
    revenueAttributed: number;
    discountGiven: number;
    usageCount: number;
    usageLimit: number | null;
  }>,
  revenue: RevenueSummary,
): Recommendation[] {
  const list: Recommendation[] = [];

  for (const campaign of campaigns) {
    if (campaign.status === 'DRAFT' && campaign.hoursToStart !== null) {
      if (campaign.hoursToStart <= 72 && campaign.hoursToStart > -1) {
        list.push({
          id: `draft-${campaign.id}`,
          severity: campaign.hoursToStart <= 24 ? 'critical' : 'warning',
          title: `«${campaign.name}» sigue en borrador`,
          explanation:
            campaign.hoursToStart <= 0
              ? 'Su ventana ya inició y todavía no está publicada, por lo que no acepta redenciones.'
              : `Arranca ${formatRelative(campaign.startsAt)} y aún no está publicada.`,
          suggestion: 'Publícala para habilitar códigos y descuentos en checkout.',
          action: { kind: 'publish', campaignId: campaign.id, label: 'Publicar campaña' },
        });
      }
    }

    if (campaign.overdue) {
      list.push({
        id: `overdue-${campaign.id}`,
        severity: 'warning',
        title: `«${campaign.name}» venció sin cerrarse`,
        explanation: `La ventana terminó ${formatRelative(campaign.endsAt)} y la campaña sigue marcada como activa.`,
        suggestion: 'Ciérrala o extiende su vigencia desde el hub del evento.',
      });
    }

    if (campaign.live && campaign.allocation > 0 && campaign.redemptionRate >= 85) {
      list.push({
        id: `capacity-${campaign.id}`,
        severity: campaign.redemptionRate >= 95 ? 'critical' : 'warning',
        title: `«${campaign.name}» casi agota su cupo`,
        explanation: `Se redimió ${formatPercentPoints(campaign.redemptionRate)} de ${formatCount(
          campaign.allocation,
        )} lugares; quedan ${formatCount(campaign.remaining)}.`,
        suggestion: 'Amplía el cupo o prepara una campaña de continuidad antes de que se agote.',
        action: { kind: 'compose', label: 'Crear campaña de continuidad' },
      });
    }

    if (
      campaign.live &&
      campaign.redeemed === 0 &&
      campaign.hoursToStart !== null &&
      campaign.hoursToStart <= -48
    ) {
      list.push({
        id: `stalled-${campaign.id}`,
        severity: 'warning',
        title: `«${campaign.name}» no registra redenciones`,
        explanation: 'Lleva más de 48 h publicada sin una sola redención de código.',
        suggestion: 'Revisa la difusión del código y el descuento ofrecido frente a la competencia.',
      });
    }

    if (campaign.type === 'presale' && campaign.codes.length > 0 && campaign.status === 'DRAFT') {
      list.push({
        id: `codes-${campaign.id}`,
        severity: 'info',
        title: `${formatCount(campaign.codes.length)} códigos listos en «${campaign.name}»`,
        explanation: 'Los códigos de preventa ya están generados y pueden entregarse a la audiencia.',
        suggestion: 'Exporta el CSV para cargarlo en tu herramienta de email o CRM.',
        action: { kind: 'export', campaignId: campaign.id, label: 'Exportar códigos' },
      });
    }
  }

  for (const promotion of promotions) {
    if (promotion.performance === 'poor' && promotion.usageCount > 0) {
      list.push({
        id: `promo-${promotion.promotionId}`,
        severity: 'warning',
        title: `El código ${promotion.code} rinde por debajo del promedio`,
        explanation: `Convierte ${formatPercentPoints(promotion.conversionRate)} y otorgó ${formatMxn(
          promotion.discountGiven,
        )} en descuentos para ${formatMxn(promotion.revenueAttributed)} de ingreso.`,
        suggestion: 'Reduce el descuento o reasigna el presupuesto a los códigos con mejor retorno.',
      });
    }
  }

  if (revenue.roas !== null && revenue.roas < 3 && revenue.discountGiven > 0) {
    list.push({
      id: 'roas-global',
      severity: revenue.roas < 1.5 ? 'critical' : 'warning',
      title: 'El retorno del descuento es bajo',
      explanation: `Cada peso de descuento genera ${formatRatio(revenue.roas)} de ingreso atribuido en el periodo.`,
      suggestion: 'Concentra el presupuesto en los códigos fuertes y limita los descuentos abiertos.',
    });
  }

  if (campaigns.length === 0) {
    list.push({
      id: 'empty-state',
      severity: 'info',
      title: 'Este evento aún no tiene campañas',
      explanation: 'Sin campañas no hay códigos de preventa ni descuentos atribuibles.',
      suggestion: 'Arranca con una preventa acotada para medir elasticidad de precio.',
      action: { kind: 'compose', label: 'Crear primera campaña' },
    });
  }

  return list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
