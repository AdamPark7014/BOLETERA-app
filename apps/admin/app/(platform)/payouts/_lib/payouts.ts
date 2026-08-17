import type { SettlementsMetrics } from '@boletera/shared';
import type { PayoutPayload } from '@/lib/queries/payouts';
import type { SettlementReport } from '@/lib/platform-api';
import { safeRatio, sumCents, toCents, type Cents } from './money';
import { daysSince, toValidDate } from './period';
import type {
  AgingBucket,
  CalendarDay,
  CalendarMonth,
  ChannelRow,
  PayoutRow,
  PayoutStatus,
  PayoutStatusMeta,
  ReconciliationCheck,
  ReconciliationSeverity,
} from './types';

// ---------------------------------------------------------------------------
// Lectura segura de payloads sin tipar
// ---------------------------------------------------------------------------

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: UnknownRecord, key: string): string | null {
  const value = source[key];
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function readAmount(source: UnknownRecord, key: string): Cents {
  const value = source[key];
  if (typeof value === 'number' || typeof value === 'string') return toCents(value);
  return 0;
}

function readCount(source: UnknownRecord, key: string): number {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readIsoDate(source: UnknownRecord, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const PAYOUT_STATUS_META: Record<PayoutStatus, PayoutStatusMeta> = {
  PENDING: { label: 'Pendiente', tone: 'warning', open: true },
  PROCESSING: { label: 'En proceso', tone: 'info', open: true },
  COMPLETED: { label: 'Pagada', tone: 'success', open: false },
  FAILED: { label: 'Fallida', tone: 'danger', open: true },
  CANCELLED: { label: 'Cancelada', tone: 'neutral', open: false },
};

export const PAYOUT_STATUSES = Object.keys(PAYOUT_STATUS_META) as PayoutStatus[];

export function isPayoutStatus(value: string): value is PayoutStatus {
  return value in PAYOUT_STATUS_META;
}

export function payoutStatusMeta(status: PayoutStatus): PayoutStatusMeta {
  return PAYOUT_STATUS_META[status];
}

/** Una liquidación se puede cerrar mientras no esté ya pagada o cancelada. */
export function canCompletePayout(row: PayoutRow): boolean {
  return row.status === 'PENDING' || row.status === 'PROCESSING' || row.status === 'FAILED';
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

function parsePayoutRecord(value: unknown): PayoutRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id');
  if (!id) return null;
  const rawStatus = readString(value, 'status') ?? 'PENDING';
  return {
    id,
    periodStart: readIsoDate(value, 'periodStart'),
    periodEnd: readIsoDate(value, 'periodEnd'),
    grossCents: readAmount(value, 'grossRevenue'),
    commissionCents: readAmount(value, 'commission'),
    netCents: readAmount(value, 'netAmount'),
    status: isPayoutStatus(rawStatus) ? rawStatus : 'PENDING',
    referenceId: readString(value, 'referenceId'),
    processedAt: readIsoDate(value, 'processedAt'),
    createdAt: readIsoDate(value, 'createdAt'),
    method: readString(value, 'method'),
  };
}

function payoutFromMetrics(row: SettlementsMetrics['payouts'][number]): PayoutRow {
  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    grossCents: toCents(row.grossRevenue),
    commissionCents: toCents(row.commission),
    netCents: toCents(row.netAmount),
    status: isPayoutStatus(row.status) ? row.status : 'PENDING',
    referenceId: row.referenceId,
    processedAt: row.processedAt,
    createdAt: null,
    method: null,
  };
}

function sortByPeriodDesc(a: PayoutRow, b: PayoutRow): number {
  const left = toValidDate(a.periodEnd)?.getTime() ?? 0;
  const right = toValidDate(b.periodEnd)?.getTime() ?? 0;
  return right - left;
}

/**
 * `GET /admin/payouts` devuelve las 50 más recientes de la organización y
 * `/metrics/settlements` las del rango elegido: se fusionan por id para que la
 * tabla muestre el histórico completo sin duplicar filas.
 */
export function normalizePayouts(
  payload: PayoutPayload | undefined,
  metrics: SettlementsMetrics | undefined,
): PayoutRow[] {
  const merged = new Map<string, PayoutRow>();

  const rawList = payload?.payouts ?? payload?.data ?? [];
  for (const raw of rawList) {
    const row = parsePayoutRecord(raw);
    if (row) merged.set(row.id, row);
  }

  for (const raw of metrics?.payouts ?? []) {
    if (merged.has(raw.id)) continue;
    merged.set(raw.id, payoutFromMetrics(raw));
  }

  return [...merged.values()].sort(sortByPeriodDesc);
}

/** Desglose de ventas por canal, base de la conciliación de comisiones. */
export function normalizeChannels(payload: PayoutPayload | undefined): ChannelRow[] {
  const raw = isRecord(payload) ? payload.byChannel : undefined;
  if (!Array.isArray(raw)) return [];

  const rows: ChannelRow[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const channel = readString(entry, 'channel') ?? 'DESCONOCIDO';
    const currency = readString(entry, 'currency') ?? 'MXN';
    const sums = isRecord(entry._sum) ? entry._sum : {};
    const grossCents = readAmount(sums, 'totalAmount');
    const commissionCents = readAmount(sums, 'commissionAmount');
    rows.push({
      id: `${channel}-${currency}`,
      channel,
      currency,
      orders: readCount(entry, '_count'),
      grossCents,
      commissionCents,
      netCents: grossCents - commissionCents,
    });
  }

  return rows.sort((a, b) => b.grossCents - a.grossCents);
}

// ---------------------------------------------------------------------------
// Derivados
// ---------------------------------------------------------------------------

export type PayoutTotals = {
  openCount: number;
  openCents: Cents;
  completedCount: number;
  completedCents: Cents;
  commissionCents: Cents;
  /** Neto liquidado / neto total comprometido. */
  settledRatio: number | null;
};

export function payoutTotals(rows: readonly PayoutRow[]): PayoutTotals {
  const open = rows.filter((row) => PAYOUT_STATUS_META[row.status].open);
  const completed = rows.filter((row) => row.status === 'COMPLETED');
  const openCents = sumCents(open.map((row) => row.netCents));
  const completedCents = sumCents(completed.map((row) => row.netCents));
  return {
    openCount: open.length,
    openCents,
    completedCount: completed.length,
    completedCents,
    commissionCents: sumCents(rows.map((row) => row.commissionCents)),
    settledRatio: safeRatio(completedCents, completedCents + openCents),
  };
}

const AGING_DEFINITION: ReadonlyArray<Omit<AgingBucket, 'count' | 'amountCents'>> = [
  { id: 'current', label: 'Al corriente (0–7 d)', fromDays: -Infinity, toDays: 7, tone: 'success' },
  { id: 'd8', label: '8–15 días', fromDays: 8, toDays: 15, tone: 'info' },
  { id: 'd16', label: '16–30 días', fromDays: 16, toDays: 30, tone: 'warning' },
  { id: 'd31', label: 'Más de 30 días', fromDays: 31, toDays: null, tone: 'danger' },
];

/** Antigüedad del saldo abierto medida desde el cierre de cada periodo. */
export function buildAging(rows: readonly PayoutRow[], now = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_DEFINITION.map((definition) => ({
    ...definition,
    count: 0,
    amountCents: 0,
  }));

  for (const row of rows) {
    if (!PAYOUT_STATUS_META[row.status].open) continue;
    const age = daysSince(row.periodEnd, now) ?? 0;
    const bucket =
      buckets.find(
        (candidate) =>
          age >= candidate.fromDays && (candidate.toDays === null || age <= candidate.toDays),
      ) ?? buckets[buckets.length - 1];
    bucket.count += 1;
    bucket.amountCents += row.netCents;
  }

  return buckets;
}

function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const monthLabelFormatter = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
});

export const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

/**
 * Rejilla mensual con las liquidaciones ancladas al cierre de su periodo, que
 * es la fecha en la que el dinero debe salir del banco.
 */
export function buildCalendar(
  rows: readonly PayoutRow[],
  cursor: Date,
  now = new Date(),
): CalendarMonth {
  const byDay = new Map<string, PayoutRow[]>();
  for (const row of rows) {
    const date = toValidDate(row.periodEnd);
    if (!date) continue;
    const key = dayKey(date);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(row);
    else byDay.set(key, [row]);
  }

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - monthStart.getDay(),
  );
  const todayKey = dayKey(now);

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + week * 7 + weekday,
      );
      const key = dayKey(date);
      const payouts = byDay.get(key) ?? [];
      days.push({
        key,
        date,
        dayOfMonth: date.getDate(),
        inCurrentMonth: date.getMonth() === monthStart.getMonth(),
        isToday: key === todayKey,
        payouts,
        amountCents: sumCents(payouts.map((row) => row.netCents)),
      });
    }
    weeks.push(days);
  }

  // La sexta semana sólo aparece cuando el mes realmente la ocupa.
  const trimmed = weeks.filter((week) => week.some((day) => day.inCurrentMonth));

  return {
    cursor: monthStart,
    label: monthLabelFormatter.format(monthStart),
    weeks: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Conciliación
// ---------------------------------------------------------------------------

/** Tolerancia de redondeo aceptable entre dos fuentes: un peso. */
const TOLERANCE_CENTS = 100;
/** Desviación relativa a partir de la cual la diferencia deja de ser un aviso. */
const WARNING_RATIO = 0.01;

function severityFor(expected: Cents | null, actual: Cents | null): ReconciliationSeverity {
  if (expected === null || actual === null) return 'unknown';
  const delta = Math.abs(actual - expected);
  if (delta <= TOLERANCE_CENTS) return 'ok';
  const reference = Math.abs(expected) || Math.abs(actual);
  return delta <= reference * WARNING_RATIO ? 'warning' : 'error';
}

function check(
  input: Omit<ReconciliationCheck, 'deltaCents' | 'severity'>,
): ReconciliationCheck {
  const { expectedCents, actualCents } = input;
  return {
    ...input,
    deltaCents:
      expectedCents === null || actualCents === null ? null : actualCents - expectedCents,
    severity: severityFor(expectedCents, actualCents),
  };
}

function reportAmount(value: number | undefined): Cents | null {
  return typeof value === 'number' && Number.isFinite(value) ? toCents(value) : null;
}

/**
 * Contrasta las tres fuentes del mismo dinero: el reporte de liquidación, los
 * agregados de métricas y las liquidaciones registradas.
 */
export function buildReconciliation(
  report: SettlementReport | undefined,
  metrics: SettlementsMetrics | undefined,
  channels: readonly ChannelRow[],
  periodPayouts: readonly PayoutRow[],
): ReconciliationCheck[] {
  const summary = report?.summary;
  const metricsGross = metrics ? toCents(metrics.summary.grossRevenue) : null;
  const metricsCommission = metrics ? toCents(metrics.summary.commission) : null;
  const metricsRefunds = metrics ? toCents(metrics.summary.refunds) : null;
  const metricsNet = metrics ? toCents(metrics.summary.netPayable) : null;

  const netFromComponents =
    metricsGross === null || metricsRefunds === null || metricsCommission === null
      ? null
      : metricsGross - metricsRefunds - metricsCommission;

  const registeredNet = sumCents(periodPayouts.map((row) => row.netCents));
  const channelGross = channels.length
    ? sumCents(channels.map((row) => row.grossCents))
    : null;

  return [
    check({
      id: 'gross',
      label: 'Ingreso bruto',
      description: 'Reporte de liquidación contra el agregado de métricas del mismo periodo.',
      expectedLabel: 'Reporte',
      actualLabel: 'Métricas',
      expectedCents: reportAmount(summary?.grossRevenue),
      actualCents: metricsGross,
    }),
    check({
      id: 'commission',
      label: 'Comisión de plataforma',
      description: 'Comisión calculada en el reporte contra la registrada en las órdenes.',
      expectedLabel: 'Reporte',
      actualLabel: 'Métricas',
      expectedCents: reportAmount(summary?.commission),
      actualCents: metricsCommission,
    }),
    check({
      id: 'net',
      label: 'Neto por pagar',
      description: 'Bruto menos reembolsos y comisión debe coincidir con el neto publicado.',
      expectedLabel: 'Bruto − reembolsos − comisión',
      actualLabel: 'Neto por pagar',
      expectedCents: netFromComponents,
      actualCents: metricsNet,
    }),
    check({
      id: 'channels',
      label: 'Ventas por canal',
      description: 'Suma de los canales de venta contra el bruto del periodo.',
      expectedLabel: 'Canales',
      actualLabel: 'Métricas',
      expectedCents: channelGross,
      actualCents: metricsGross,
    }),
    check({
      id: 'registered',
      label: 'Liquidaciones registradas',
      description:
        'Neto por pagar del periodo contra la suma de las liquidaciones ya generadas.',
      expectedLabel: 'Neto por pagar',
      actualLabel: 'Registrado',
      expectedCents: metricsNet,
      actualCents: periodPayouts.length ? registeredNet : null,
    }),
  ];
}

export const RECONCILIATION_TONE: Record<ReconciliationSeverity, 'success' | 'warning' | 'danger' | 'neutral'> =
  {
    ok: 'success',
    warning: 'warning',
    error: 'danger',
    unknown: 'neutral',
  };

export const RECONCILIATION_LABEL: Record<ReconciliationSeverity, string> = {
  ok: 'Cuadra',
  warning: 'Diferencia menor',
  error: 'Descuadre',
  unknown: 'Sin datos',
};

/** Filtra por texto libre sobre referencia, id y periodo. */
export function payoutMatchesQuery(row: PayoutRow, needle: string): boolean {
  if (!needle) return true;
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return (
    row.id.toLowerCase().includes(query) ||
    (row.referenceId?.toLowerCase().includes(query) ?? false) ||
    (row.periodStart?.slice(0, 10).includes(query) ?? false) ||
    (row.periodEnd?.slice(0, 10).includes(query) ?? false)
  );
}
