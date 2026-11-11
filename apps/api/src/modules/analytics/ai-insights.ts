/**
 * Cálculos deterministas detrás de las rutas `/ai/*`.
 *
 * Aquí NO hay modelo de lenguaje ni nada aleatorio: cada cifra sale de órdenes,
 * reembolsos o señales de fraude reales, y cada texto es una plantilla que sólo
 * cita esas cifras. Lo que no tiene fuente devuelve vacío con un `reason`.
 *
 * Todo es puro (sin Prisma) para poder probarlo con datos fijos.
 */
import type {
  AiAnomalyMetric,
  AiAnomalyPoint,
  AiConfidenceInterval,
  AiConfidenceLevel,
  AiCustomerSegment,
  AiCustomerSegmentRow,
  AiDataSufficiency,
  AiFactor,
  AiFraudRiskBand,
  AiFraudRiskScore,
  AiRecommendation,
  AiRecommendationPriority,
} from '@boletera/shared';

export const AI_TIMEZONE = 'America/Mexico_City' as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Motivos de vacío. Se reutilizan en servicio, pruebas y pantalla. */
export const AI_REASONS = {
  noSales: 'sin ventas en el periodo',
  noEventSales: 'sin ventas registradas para este evento',
  noLineItems:
    'el evento tiene órdenes completadas pero sin partidas de boletos: no se puede medir el ritmo en boletos',
  noFlags: 'sin señales de fraude abiertas en el periodo',
  noCustomers: 'sin clientes con órdenes completadas en el periodo',
  noBaseline:
    'sin días suficientes con variación para una línea base (se necesitan 7 días previos con ventas distintas)',
  noRecommendations: 'ninguna regla se activó con los datos del periodo',
} as const;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: AI_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día calendario (YYYY-MM-DD) en la zona del negocio. */
export function dayKey(date: Date): string {
  return dayFormatter.format(date);
}

/** Días calendario consecutivos que cubren [from, to], en la zona del negocio. */
export function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS / 2) {
    const key = dayKey(new Date(t));
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const last = dayKey(to);
  if (!seen.has(last)) keys.push(last);
  return keys;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Desviación estándar poblacional. */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Variación porcentual; `null` cuando el periodo anterior es 0 (no hay base). */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

export function formatMxn(value: number): string {
  return mxn.format(value);
}
function formatInt(value: number): string {
  return int.format(value);
}
/** «1 orden», «3 órdenes». */
function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}
function formatPct(value: number): string {
  return `${pct.format(value)} %`;
}

// ---------------------------------------------------------------------------
// Agregados de ventas
// ---------------------------------------------------------------------------

/** Orden ya normalizada (montos en número, fecha efectiva de venta). */
export interface SaleRow {
  orderId: string;
  eventId: string;
  eventTitle: string;
  userId: string;
  email: string;
  channel: string;
  amount: number;
  tickets: number;
  soldAt: Date;
}

export interface RefundRow {
  amount: number;
  processedAt: Date;
}

export interface SalesTotals {
  orders: number;
  tickets: number;
  grossRevenue: number;
  averageOrderValue: number;
  refundAmount: number;
  byChannel: Array<{ channel: string; orders: number; revenue: number }>;
  byEvent: Array<{ eventId: string; title: string; tickets: number; revenue: number }>;
}

export function aggregateSales(sales: SaleRow[], refunds: RefundRow[] = []): SalesTotals {
  const byChannel = new Map<string, { orders: number; revenue: number }>();
  const byEvent = new Map<string, { title: string; tickets: number; revenue: number }>();
  let tickets = 0;
  let revenue = 0;
  for (const sale of sales) {
    tickets += sale.tickets;
    revenue += sale.amount;
    const ch = byChannel.get(sale.channel) ?? { orders: 0, revenue: 0 };
    ch.orders += 1;
    ch.revenue += sale.amount;
    byChannel.set(sale.channel, ch);
    const ev = byEvent.get(sale.eventId) ?? { title: sale.eventTitle, tickets: 0, revenue: 0 };
    ev.tickets += sale.tickets;
    ev.revenue += sale.amount;
    byEvent.set(sale.eventId, ev);
  }
  return {
    orders: sales.length,
    tickets,
    grossRevenue: round(revenue),
    averageOrderValue: sales.length ? round(revenue / sales.length) : 0,
    refundAmount: round(refunds.reduce((sum, r) => sum + r.amount, 0)),
    byChannel: [...byChannel.entries()]
      .map(([channel, v]) => ({ channel, orders: v.orders, revenue: round(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders),
    byEvent: [...byEvent.entries()]
      .map(([eventId, v]) => ({
        eventId,
        title: v.title,
        tickets: v.tickets,
        revenue: round(v.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue || b.tickets - a.tickets),
  };
}

// ---------------------------------------------------------------------------
// Resumen ejecutivo (plantillas sobre cifras)
// ---------------------------------------------------------------------------

export interface NarrativeKpi {
  key: string;
  label: string;
  value: number;
  previousValue: number;
  deltaPercent: number | null;
  unit: 'mxn' | 'count' | 'percent' | 'ratio';
}

export interface NarrativeOutput {
  narrative: string;
  highlights: string[];
  watchouts: string[];
  kpisCited: NarrativeKpi[];
  reason?: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'web',
  TAQUILLA: 'taquilla',
  API: 'API',
  ADMIN: 'administración',
  PROMOTER: 'promotor',
  COURTESY: 'cortesía',
  CORPORATE: 'corporativo',
  MOBILE: 'app móvil',
  PHONE: 'teléfono',
  INVITATION: 'invitación',
  AFFILIATE: 'afiliados',
  VIP: 'VIP',
  RESALE: 'reventa',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel;
}

function describeDelta(delta: number | null): string {
  if (delta === null) return 'sin base de comparación en el periodo anterior';
  if (delta === 0) return 'igual que el periodo anterior';
  return `${delta > 0 ? '+' : ''}${pct.format(delta)} % contra el periodo anterior`;
}

/**
 * Narrativa determinista. Umbral de alerta: caída ≥ 20 % en ingresos u órdenes,
 * o reembolsos ≥ 10 % del ingreso bruto. Sólo se citan cifras observadas.
 */
export function buildExecutiveNarrative(
  current: SalesTotals,
  previous: SalesTotals,
  extra: { openFraudFlags: number } = { openFraudFlags: 0 }
): NarrativeOutput {
  const kpisCited: NarrativeKpi[] = [
    {
      key: 'gross_revenue',
      label: 'Ingreso bruto',
      value: current.grossRevenue,
      previousValue: previous.grossRevenue,
      deltaPercent: deltaPercent(current.grossRevenue, previous.grossRevenue),
      unit: 'mxn',
    },
    {
      key: 'orders',
      label: 'Órdenes completadas',
      value: current.orders,
      previousValue: previous.orders,
      deltaPercent: deltaPercent(current.orders, previous.orders),
      unit: 'count',
    },
    {
      key: 'tickets_sold',
      label: 'Boletos vendidos',
      value: current.tickets,
      previousValue: previous.tickets,
      deltaPercent: deltaPercent(current.tickets, previous.tickets),
      unit: 'count',
    },
    {
      key: 'average_order_value',
      label: 'Valor promedio por orden',
      value: current.averageOrderValue,
      previousValue: previous.averageOrderValue,
      deltaPercent: deltaPercent(current.averageOrderValue, previous.averageOrderValue),
      unit: 'mxn',
    },
    {
      key: 'refund_amount',
      label: 'Reembolsos procesados',
      value: current.refundAmount,
      previousValue: previous.refundAmount,
      deltaPercent: deltaPercent(current.refundAmount, previous.refundAmount),
      unit: 'mxn',
    },
  ];

  if (current.orders === 0 && previous.orders === 0) {
    return { narrative: '', highlights: [], watchouts: [], kpisCited, reason: AI_REASONS.noSales };
  }

  const revenueDelta = kpisCited[0].deltaPercent;
  const ordersDelta = kpisCited[1].deltaPercent;

  const narrative =
    current.orders === 0
      ? `No hubo órdenes completadas en el periodo. El periodo anterior tuvo ${plural(previous.orders, 'orden', 'órdenes')} por ${formatMxn(previous.grossRevenue)}.`
      : `En el periodo se completaron ${plural(current.orders, 'orden', 'órdenes')} ${
          current.tickets > 0
            ? `con ${plural(current.tickets, 'boleto', 'boletos')}`
            : 'sin partidas de boletos registradas'
        } por ${formatMxn(current.grossRevenue)} de ingreso bruto (${describeDelta(revenueDelta)}). El valor promedio por orden fue ${formatMxn(current.averageOrderValue)}.`;

  const highlights: string[] = [];
  const topChannel = current.byChannel[0];
  if (topChannel && current.grossRevenue > 0) {
    highlights.push(
      `El canal ${channelLabel(topChannel.channel)} concentró ${formatPct((topChannel.revenue / current.grossRevenue) * 100)} del ingreso (${plural(topChannel.orders, 'orden', 'órdenes')}).`
    );
  }
  const topEvent = current.byEvent[0];
  if (topEvent) {
    highlights.push(
      `El evento con más ingreso fue «${topEvent.title}»: ${formatMxn(topEvent.revenue)}${
        topEvent.tickets > 0 ? ` por ${plural(topEvent.tickets, 'boleto', 'boletos')}` : ''
      }.`
    );
  }
  if (revenueDelta !== null && revenueDelta >= 20) {
    highlights.push(
      `El ingreso bruto creció ${formatPct(revenueDelta)} contra el periodo anterior.`
    );
  }

  const watchouts: string[] = [];
  if (revenueDelta !== null && revenueDelta <= -20) {
    watchouts.push(
      `El ingreso bruto cayó ${formatPct(Math.abs(revenueDelta))} contra el periodo anterior.`
    );
  }
  if (ordersDelta !== null && ordersDelta <= -20) {
    watchouts.push(`Las órdenes completadas cayeron ${formatPct(Math.abs(ordersDelta))}.`);
  }
  if (current.grossRevenue > 0 && current.refundAmount / current.grossRevenue >= 0.1) {
    watchouts.push(
      `Los reembolsos (${formatMxn(current.refundAmount)}) equivalen a ${formatPct((current.refundAmount / current.grossRevenue) * 100)} del ingreso bruto.`
    );
  }
  if (extra.openFraudFlags > 0) {
    watchouts.push(
      `Hay ${plural(extra.openFraudFlags, 'señal', 'señales')} de fraude abiertas creadas en el periodo.`
    );
  }

  return { narrative, highlights, watchouts, kpisCited };
}

// ---------------------------------------------------------------------------
// Anomalías: z-score contra media móvil de los 7 días previos
// ---------------------------------------------------------------------------

export const ANOMALY_WINDOW = 7;
export const DEFAULT_Z_THRESHOLD = 2.5;

export interface DailyPoint {
  day: string;
  value: number;
}

/** Serie diaria (con ceros) a partir de filas con fecha y valor. */
export function dailySeries<T>(
  rows: T[],
  days: string[],
  pick: (row: T) => { at: Date; value: number }
): DailyPoint[] {
  const totals = new Map<string, number>(days.map((d) => [d, 0]));
  for (const row of rows) {
    const { at, value } = pick(row);
    const key = dayKey(at);
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return days.map((day) => ({ day, value: round(totals.get(day) ?? 0) }));
}

function severityFor(absZ: number): AiAnomalyPoint['severity'] {
  if (absZ >= 4) return 'critical';
  if (absZ >= 3) return 'alert';
  return 'watch';
}

const METRIC_LABEL: Record<AiAnomalyMetric, string> = {
  tickets_sold: 'boletos vendidos',
  gross_revenue: 'ingreso bruto',
  refund_amount: 'monto reembolsado',
  payment_approval_rate: 'aprobación de pagos',
  access_traffic: 'tráfico de accesos',
};

/**
 * Para cada día del rango evaluado compara el valor con la media y desviación
 * estándar de los `ANOMALY_WINDOW` días anteriores. Si la ventana no tiene
 * variación (desviación 0) el día no se evalúa: con base plana cualquier z
 * sería infinito y no informativo.
 *
 * @param series serie completa: los primeros `ANOMALY_WINDOW` puntos son sólo base.
 */
export function detectAnomalies(
  metric: AiAnomalyMetric,
  series: DailyPoint[],
  zThreshold = DEFAULT_Z_THRESHOLD
): { anomalies: AiAnomalyPoint[]; evaluated: number } {
  const anomalies: AiAnomalyPoint[] = [];
  let evaluated = 0;
  const isMoney = metric === 'gross_revenue' || metric === 'refund_amount';
  const fmt = (v: number) => (isMoney ? formatMxn(v) : pct.format(v));
  for (let i = ANOMALY_WINDOW; i < series.length; i += 1) {
    const window = series.slice(i - ANOMALY_WINDOW, i).map((p) => p.value);
    const baselineMean = mean(window);
    const baselineStd = stdDev(window);
    if (baselineStd === 0) continue;
    evaluated += 1;
    const observed = series[i].value;
    const z = (observed - baselineMean) / baselineStd;
    if (Math.abs(z) < zThreshold) continue;
    const direction = z > 0 ? 'spike' : 'drop';
    anomalies.push({
      metric,
      bucket: series[i].day,
      observed,
      baselineMean: round(baselineMean),
      baselineStd: round(baselineStd),
      zScore: round(z),
      direction,
      severity: severityFor(Math.abs(z)),
      explanation: `El ${series[i].day} hubo ${fmt(observed)} de ${METRIC_LABEL[metric]}, ${direction === 'spike' ? 'por encima' : 'por debajo'} de la media de los ${ANOMALY_WINDOW} días previos (${fmt(round(baselineMean))}; z = ${pct.format(round(z))}).`,
    });
  }
  return { anomalies, evaluated };
}

export function anomalySufficiency(evaluated: number): AiDataSufficiency {
  if (evaluated === 0) return 'insufficient';
  if (evaluated < 14) return 'limited';
  return 'sufficient';
}

// ---------------------------------------------------------------------------
// Riesgo de fraude a partir de FraudFlag
// ---------------------------------------------------------------------------

/** Umbrales de FraudService (fraud.service.ts THRESHOLDS). */
export const FRAUD_THRESHOLDS = { LOW: 30, MEDIUM: 50, HIGH: 75, CRITICAL: 90 } as const;

export interface FlagRow {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  score: number;
  reason: string;
  orderId: string | null;
  userId: string | null;
  eventId: string | null;
}

const FRAUD_TYPE_LABEL: Record<string, string> = {
  SUSPICIOUS_ACTIVITY: 'Actividad sospechosa',
  DUPLICATE_PURCHASE: 'Compra duplicada',
  HIGH_VELOCITY: 'Velocidad alta',
  UNLIKELY_LOCATION: 'Ubicación inusual',
  MULTIPLE_DECLINED: 'Pagos rechazados',
  CHARGEBACK: 'Contracargo',
  ACCOUNT_BREACH: 'Cuenta comprometida',
  BOT_ACTIVITY: 'Actividad de bot',
  SCALPING_VIOLATION: 'Reventa no permitida',
  KYC_MISMATCH: 'Identidad no coincide',
};

/** Puntaje de una señal: el guardado; si quedó en 0, el mínimo de su severidad. */
export function flagScore(flag: Pick<FlagRow, 'score' | 'severity'>): number {
  if (flag.score > 0) return Math.min(flag.score, 100);
  return FRAUD_THRESHOLDS[flag.severity as keyof typeof FRAUD_THRESHOLDS] ?? 0;
}

/** Banda con los umbrales de FraudService: <50 baja, <75 media, <90 alta, ≥90 crítica. */
export function fraudBand(score: number): AiFraudRiskBand {
  if (score >= FRAUD_THRESHOLDS.CRITICAL) return 'critical';
  if (score >= FRAUD_THRESHOLDS.HIGH) return 'high';
  if (score >= FRAUD_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Agrupa señales abiertas por orden (o por usuario si no hay orden). El puntaje
 * del sujeto es el de su señal más alta: cada señal ya es la suma ponderada de
 * reglas de `FraudService.analyzeFraud`, así que sumarlas contaría doble.
 */
export function scoreFraudSubjects(flags: FlagRow[]): AiFraudRiskScore[] {
  const groups = new Map<string, { type: 'order' | 'user'; id: string; flags: FlagRow[] }>();
  for (const flag of flags) {
    const subject = flag.orderId
      ? { type: 'order' as const, id: flag.orderId }
      : flag.userId
        ? { type: 'user' as const, id: flag.userId }
        : null;
    if (!subject) continue;
    const key = `${subject.type}:${subject.id}`;
    const group = groups.get(key) ?? { ...subject, flags: [] };
    group.flags.push(flag);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const score = Math.max(...group.flags.map(flagScore));
      const factors: AiFactor[] = group.flags
        .map((flag) => ({
          key: `${flag.type}-${flag.id}`,
          label: FRAUD_TYPE_LABEL[flag.type] ?? flag.type,
          weight: round(flagScore(flag) / 100),
          value: flagScore(flag),
          explanation: flag.reason,
        }))
        .sort((a, b) => b.weight - a.weight);
      const orderIds = [...new Set(group.flags.map((f) => f.orderId).filter(Boolean))] as string[];
      const eventIds = [...new Set(group.flags.map((f) => f.eventId).filter(Boolean))] as string[];
      return {
        subjectType: group.type,
        subjectId: group.id,
        score: round(score, 1),
        band: fraudBand(score),
        factors,
        ...(orderIds.length ? { relatedOrderIds: orderIds } : {}),
        ...(eventIds.length ? { relatedEventIds: eventIds } : {}),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function fraudSummary(scores: AiFraudRiskScore[]) {
  return {
    scored: scores.length,
    highOrCritical: scores.filter((s) => s.band === 'high' || s.band === 'critical').length,
    averageScore: scores.length ? round(mean(scores.map((s) => s.score)), 1) : 0,
  };
}

// ---------------------------------------------------------------------------
// Segmentación RFM
// ---------------------------------------------------------------------------

export interface CustomerHistory {
  userId: string;
  email: string;
  orders: Array<{ amount: number; soldAt: Date }>;
}

/**
 * Reglas fijas (sin cuantiles, para que una muestra chica no mueva los cortes):
 *  - 1 compra y la última hace ≤ 30 días → nuevo
 *  - ≥ 3 compras y la última hace ≤ 60 días → campeón
 *  - ≥ 2 compras y la última hace ≤ 90 días → leal
 *  - 1 compra y la última hace 31–90 días → prometedor
 *  - última compra hace 91–180 días → en riesgo
 *  - última compra hace > 180 días → hibernando
 */
export function rfmSegment(recencyDays: number, frequency: number): AiCustomerSegment {
  if (frequency <= 0) return 'insufficient_history';
  if (frequency === 1 && recencyDays <= 30) return 'new';
  if (frequency >= 3 && recencyDays <= 60) return 'champion';
  if (frequency >= 2 && recencyDays <= 90) return 'loyal';
  if (recencyDays <= 90) return 'promising';
  if (recencyDays <= 180) return 'at_risk';
  return 'hibernating';
}

export function segmentCustomers(customers: CustomerHistory[], asOf: Date) {
  const rows: AiCustomerSegmentRow[] = customers
    .filter((c) => c.orders.length > 0)
    .map((c) => {
      const last = Math.max(...c.orders.map((o) => o.soldAt.getTime()));
      const recencyDays = Math.max(0, Math.floor((asOf.getTime() - last) / DAY_MS));
      const frequency = c.orders.length;
      const monetaryMxn = round(c.orders.reduce((sum, o) => sum + o.amount, 0));
      return {
        userId: c.userId,
        email: c.email,
        segment: rfmSegment(recencyDays, frequency),
        recencyDays,
        frequency,
        monetaryMxn,
        // Sin modelo de abandono entrenado: no se publica probabilidad.
        churnProbability: null,
        churnConfidence: 'none' as AiConfidenceLevel,
        factors: [
          {
            key: 'recency',
            label: 'Recencia',
            weight: 0,
            value: recencyDays,
            explanation: `Última compra completada hace ${plural(recencyDays, 'día', 'días')}.`,
          },
          {
            key: 'frequency',
            label: 'Frecuencia',
            weight: 0,
            value: frequency,
            explanation: `${plural(frequency, 'orden completada', 'órdenes completadas')}.`,
          },
          {
            key: 'monetary',
            label: 'Monto',
            weight: 0,
            value: monetaryMxn,
            explanation: `${formatMxn(monetaryMxn)} en órdenes completadas.`,
          },
        ],
      };
    })
    .sort((a, b) => b.monetaryMxn - a.monetaryMxn);

  const counts = new Map<AiCustomerSegment, { count: number; monetary: number }>();
  for (const row of rows) {
    const c = counts.get(row.segment) ?? { count: 0, monetary: 0 };
    c.count += 1;
    c.monetary += row.monetaryMxn;
    counts.set(row.segment, c);
  }
  const segments = [...counts.entries()]
    .map(([segment, c]) => ({
      segment,
      count: c.count,
      percentOfTotal: round((c.count / rows.length) * 100, 1),
      averageMonetaryMxn: round(c.monetary / c.count),
    }))
    .sort((a, b) => b.count - a.count);

  const sufficiency: AiDataSufficiency =
    rows.length === 0 ? 'insufficient' : rows.length < 20 ? 'limited' : 'sufficient';
  return { rows, segments, sufficiency };
}

// ---------------------------------------------------------------------------
// Pronóstico lineal de ritmo por evento
// ---------------------------------------------------------------------------

/** z de una normal para un intervalo central del 80 %. */
const Z80 = 1.2816;

export interface LinearFit {
  slope: number;
  intercept: number;
  residualStd: number;
  n: number;
  meanX: number;
  sxx: number;
}

/** Mínimos cuadrados ordinarios y = a + b·x. */
export function linearFit(points: Array<{ x: number; y: number }>): LinearFit | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = mean(points.map((p) => p.x));
  const meanY = mean(points.map((p) => p.y));
  const sxx = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const sse = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const residualStd = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  return { slope, intercept, residualStd, n, meanX, sxx };
}

export function forecastConfidence(days: number): {
  level: AiConfidenceLevel;
  sufficiency: AiDataSufficiency;
} {
  if (days < 3) return { level: 'none', sufficiency: 'insufficient' };
  if (days < 7) return { level: 'low', sufficiency: 'limited' };
  if (days < 14) return { level: 'medium', sufficiency: 'sufficient' };
  return { level: 'high', sufficiency: 'sufficient' };
}

export interface EventForecastInput {
  capacity: number;
  /** Boletos vendidos por día, desde el primer día con venta hasta hoy (o el evento). */
  daily: DailyPoint[];
  revenue: number;
  daysUntilEvent: number;
}

export interface EventForecastOutput {
  ticketsSold: number;
  observedPace: Array<{ dayIndex: number; cumulativeOccupancy: number }>;
  projectedTickets: AiConfidenceInterval;
  projectedOccupancy: AiConfidenceInterval;
  projectedRevenue: AiConfidenceInterval;
  rationale: string;
  reason?: string;
}

/**
 * Ajusta una recta al acumulado de boletos de los últimos 14 días con venta
 * observada y la extiende hasta el día del evento, con intervalo de predicción
 * del 80 %. Se recorta a [vendidos, aforo]. Si el evento ya empezó, la
 * proyección es lo vendido. Con menos de 3 días no se proyecta.
 */
export function forecastEvent(input: EventForecastInput): EventForecastOutput {
  const capacity = Math.max(0, input.capacity);
  let cumulative = 0;
  const cumulativeSeries = input.daily.map((point, index) => {
    cumulative += point.value;
    return { x: index, y: cumulative };
  });
  const ticketsSold = cumulative;
  const pricePerTicket = ticketsSold > 0 ? input.revenue / ticketsSold : 0;
  const observedPace = cumulativeSeries.map((p) => ({
    dayIndex: p.x,
    cumulativeOccupancy: capacity > 0 ? round(p.y / capacity, 4) : 0,
  }));
  const { level, sufficiency } = forecastConfidence(cumulativeSeries.length);
  const toOccupancy = (t: number) => (capacity > 0 ? round((t / capacity) * 100, 1) : 0);

  const build = (
    point: number,
    lower: number,
    upper: number,
    lvl = level,
    suff = sufficiency,
    n = cumulativeSeries.length
  ) => {
    const tickets: AiConfidenceInterval = {
      point: Math.round(point),
      lower: Math.round(lower),
      upper: Math.round(upper),
      coverage: 0.8,
      level: lvl,
      sampleSize: n,
      sufficiency: suff,
    };
    return {
      projectedTickets: tickets,
      projectedOccupancy: {
        ...tickets,
        point: toOccupancy(tickets.point),
        lower: toOccupancy(tickets.lower),
        upper: toOccupancy(tickets.upper),
      },
      projectedRevenue: {
        ...tickets,
        point: round(tickets.point * pricePerTicket),
        lower: round(tickets.lower * pricePerTicket),
        upper: round(tickets.upper * pricePerTicket),
      },
    };
  };

  if (ticketsSold === 0) {
    return {
      ticketsSold,
      observedPace: [],
      ...build(0, 0, 0, 'none', 'insufficient', 0),
      rationale: 'Sin ventas no hay ritmo que extender.',
      reason: AI_REASONS.noEventSales,
    };
  }
  if (input.daysUntilEvent <= 0) {
    return {
      ticketsSold,
      observedPace,
      ...build(ticketsSold, ticketsSold, ticketsSold),
      rationale: 'El evento ya empezó: la proyección es lo vendido.',
    };
  }
  const recent = cumulativeSeries.slice(-14);
  const fit = recent.length >= 3 ? linearFit(recent) : null;
  if (!fit) {
    return {
      ticketsSold,
      observedPace,
      ...build(ticketsSold, ticketsSold, ticketsSold, 'none', 'insufficient'),
      rationale:
        'Menos de 3 días con historial de venta: no se extiende el ritmo; se reporta lo vendido.',
      reason: 'menos de 3 días de historial de venta para proyectar',
    };
  }
  const lastX = cumulativeSeries.length - 1;
  const x0 = lastX + input.daysUntilEvent;
  const slope = Math.max(0, fit.slope);
  const pointRaw = ticketsSold + slope * input.daysUntilEvent;
  const se = fit.residualStd * Math.sqrt(1 + 1 / fit.n + (x0 - fit.meanX) ** 2 / fit.sxx);
  const ceiling = capacity > 0 ? capacity : Number.POSITIVE_INFINITY;
  const clamp = (v: number) => Math.min(Math.max(v, ticketsSold), ceiling);
  return {
    ticketsSold,
    observedPace,
    ...build(clamp(pointRaw), clamp(pointRaw - Z80 * se), clamp(pointRaw + Z80 * se)),
    rationale: `Recta de mínimos cuadrados sobre el acumulado de ${recent.length} días (${pct.format(round(slope, 1))} boletos/día), extendida ${formatInt(input.daysUntilEvent)} días; intervalo de predicción del 80 % recortado al aforo.`,
  };
}

// ---------------------------------------------------------------------------
// Recomendaciones por reglas
// ---------------------------------------------------------------------------

export interface UpcomingEventSignal {
  eventId: string;
  title: string;
  daysUntilEvent: number;
  capacity: number;
  ticketsSold: number;
  projectedOccupancy: number;
  sufficiency: AiDataSufficiency;
  confidence: AiConfidenceLevel;
  sampleSize: number;
}

/**
 * Reglas:
 *  1. Evento a ≤ 30 días sin ventas → impulsar venta (alta).
 *  2. Evento con proyección < 60 % de ocupación y muestra suficiente o limitada
 *     → impulsar venta (alta si faltan ≤ 14 días, media si no).
 *  3. Anomalía alerta/crítica → investigar (urgente si es crítica).
 *  4. Sujetos de fraude alto/crítico → revisar señales (urgente si hay críticos).
 * El impacto se deja en `null`: no hay modelo causal para estimarlo.
 */
export function buildRecommendations(input: {
  events: UpcomingEventSignal[];
  anomalies: AiAnomalyPoint[];
  fraud: AiFraudRiskScore[];
}): AiRecommendation[] {
  const recs: AiRecommendation[] = [];

  for (const ev of input.events) {
    if (ev.ticketsSold === 0 && ev.daysUntilEvent <= 30) {
      recs.push({
        id: `boost-zero-${ev.eventId}`,
        kind: 'boost_sales_pace',
        priority: 'high',
        title: `«${ev.title}» no tiene ventas`,
        action:
          'Revisa que el evento esté publicado y a la venta, y activa una campaña o canal adicional.',
        rationale: `0 boletos vendidos de ${formatInt(ev.capacity)} a ${formatInt(ev.daysUntilEvent)} días del evento.`,
        estimatedImpact: null,
        confidence: 'high',
        sufficiency: 'sufficient',
        sampleSize: 0,
        entityType: 'event',
        entityId: ev.eventId,
        entityLabel: ev.title,
        factors: [
          {
            key: 'days_until_event',
            label: 'Días al evento',
            weight: 1,
            value: ev.daysUntilEvent,
            explanation: `Faltan ${formatInt(ev.daysUntilEvent)} días.`,
          },
        ],
      });
      continue;
    }
    if (ev.ticketsSold > 0 && ev.sufficiency !== 'insufficient' && ev.projectedOccupancy < 60) {
      const priority: AiRecommendationPriority = ev.daysUntilEvent <= 14 ? 'high' : 'medium';
      recs.push({
        id: `boost-pace-${ev.eventId}`,
        kind: 'boost_sales_pace',
        priority,
        title: `Ritmo bajo en «${ev.title}»`,
        action: 'Refuerza la difusión o revisa precios y zonas antes de la fecha.',
        rationale: `Al ritmo actual cerraría en ${formatPct(ev.projectedOccupancy)} de ocupación (${formatInt(ev.ticketsSold)} de ${formatInt(ev.capacity)} vendidos, faltan ${formatInt(ev.daysUntilEvent)} días).`,
        estimatedImpact: null,
        confidence: ev.confidence,
        sufficiency: ev.sufficiency,
        sampleSize: ev.sampleSize,
        entityType: 'event',
        entityId: ev.eventId,
        entityLabel: ev.title,
        factors: [
          {
            key: 'projected_occupancy',
            label: 'Ocupación proyectada',
            weight: round((60 - ev.projectedOccupancy) / 60),
            value: ev.projectedOccupancy,
            explanation: `Proyección lineal por debajo del 60 %.`,
          },
        ],
      });
    }
  }

  for (const a of input.anomalies) {
    if (a.severity === 'watch') continue;
    recs.push({
      id: `anomaly-${a.metric}-${a.bucket}`,
      kind: 'investigate_anomaly',
      priority: a.severity === 'critical' ? 'urgent' : 'high',
      title: `${a.direction === 'spike' ? 'Pico' : 'Caída'} en ${METRIC_LABEL[a.metric]} el ${a.bucket}`,
      action: 'Revisa las órdenes, reembolsos y campañas de ese día.',
      rationale: a.explanation,
      estimatedImpact: null,
      confidence: Math.abs(a.zScore) >= 4 ? 'high' : 'medium',
      sufficiency: 'sufficient',
      sampleSize: ANOMALY_WINDOW,
      factors: [
        {
          key: 'z_score',
          label: 'Puntaje z',
          weight: round(Math.min(Math.abs(a.zScore) / 5, 1)),
          value: a.zScore,
          explanation: `Desviación de ${pct.format(a.zScore)} veces la variación habitual.`,
        },
      ],
    });
  }

  const risky = input.fraud.filter((s) => s.band === 'high' || s.band === 'critical');
  if (risky.length > 0) {
    const critical = risky.filter((s) => s.band === 'critical').length;
    recs.push({
      id: 'fraud-review',
      kind: 'mitigate_fraud',
      priority: critical > 0 ? 'urgent' : 'high',
      title: `${formatInt(risky.length)} sujetos con riesgo alto o crítico`,
      action: 'Revisa y resuelve las señales en Fraude antes de liberar boletos o reembolsos.',
      rationale: `${formatInt(critical)} críticos y ${formatInt(risky.length - critical)} altos según las señales abiertas del periodo.`,
      estimatedImpact: null,
      confidence: 'high',
      sufficiency: 'sufficient',
      sampleSize: risky.length,
      factors: [],
    });
  }

  const rank: Record<AiRecommendationPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return recs.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
