import type { MetricsGranularity } from '@boletera/shared';

/**
 * Rango de fechas del panel. `from` es inclusivo y `to` exclusivo, igual que
 * los filtros `gte` / `lt` que aplica `/metrics/*` en el backend.
 */
export interface IsoRange {
  readonly from: string;
  readonly to: string;
}

export type RangePresetId = 'today' | '7d' | '28d' | '90d' | 'mtd' | 'ytd' | 'custom';

/** Base contra la que se compara el periodo seleccionado. */
export type ComparisonMode = 'previous' | 'year' | 'none';

export interface RangePreset {
  readonly id: RangePresetId;
  readonly label: string;
  readonly shortLabel: string;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { id: 'today', label: 'Hoy', shortLabel: 'Hoy' },
  { id: '7d', label: 'Últimos 7 días', shortLabel: '7 d' },
  { id: '28d', label: 'Últimos 28 días', shortLabel: '28 d' },
  { id: '90d', label: 'Últimos 90 días', shortLabel: '90 d' },
  { id: 'mtd', label: 'Mes en curso', shortLabel: 'Mes' },
  { id: 'ytd', label: 'Año en curso', shortLabel: 'Año' },
  { id: 'custom', label: 'Personalizado', shortLabel: 'Rango' },
];

export const COMPARISON_MODES: readonly { id: ComparisonMode; label: string }[] = [
  { id: 'previous', label: 'Periodo anterior' },
  { id: 'year', label: 'Mismo periodo del año pasado' },
  { id: 'none', label: 'Sin comparación' },
];

const DAY_MS = 86_400_000;

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function isRangePresetId(value: string): value is RangePresetId {
  return RANGE_PRESETS.some((preset) => preset.id === value);
}

export function isComparisonMode(value: string): value is ComparisonMode {
  return value === 'previous' || value === 'year' || value === 'none';
}

export function parsePresetId(value: string | null): RangePresetId | null {
  return value !== null && isRangePresetId(value) ? value : null;
}

export function parseComparisonMode(value: string | null): ComparisonMode | null {
  return value !== null && isComparisonMode(value) ? value : null;
}

/**
 * Traduce un preset a un rango concreto. Todos los presets terminan al final
 * del día en curso para que el periodo incluya las ventas de hoy.
 */
export function resolvePreset(id: RangePresetId, reference: Date = new Date()): IsoRange {
  const today = startOfDay(reference);
  const tomorrow = addDays(today, 1);

  switch (id) {
    case 'today':
      return { from: today.toISOString(), to: tomorrow.toISOString() };
    case '7d':
      return { from: addDays(today, -6).toISOString(), to: tomorrow.toISOString() };
    case '28d':
      return { from: addDays(today, -27).toISOString(), to: tomorrow.toISOString() };
    case '90d':
      return { from: addDays(today, -89).toISOString(), to: tomorrow.toISOString() };
    case 'mtd':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
        to: tomorrow.toISOString(),
      };
    case 'ytd':
      return {
        from: new Date(today.getFullYear(), 0, 1).toISOString(),
        to: tomorrow.toISOString(),
      };
    case 'custom':
      return { from: addDays(today, -27).toISOString(), to: tomorrow.toISOString() };
  }
}

/** Duración del rango en días (mínimo 1). */
export function rangeDays(range: IsoRange): number {
  const span = Date.parse(range.to) - Date.parse(range.from);
  return Math.max(1, Math.round(span / DAY_MS));
}

/** Rango de comparación equivalente, o `null` cuando se desactiva. */
export function comparisonRange(range: IsoRange, mode: ComparisonMode): IsoRange | null {
  if (mode === 'none') return null;

  const from = new Date(range.from);
  const to = new Date(range.to);

  if (mode === 'year') {
    const shiftedFrom = new Date(from);
    shiftedFrom.setFullYear(shiftedFrom.getFullYear() - 1);
    const shiftedTo = new Date(to);
    shiftedTo.setFullYear(shiftedTo.getFullYear() - 1);
    return { from: shiftedFrom.toISOString(), to: shiftedTo.toISOString() };
  }

  const span = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - span).toISOString(),
    to: range.from,
  };
}

/** Granularidad que produce entre ~10 y ~90 puntos para el rango dado. */
export function recommendedGranularity(range: IsoRange): MetricsGranularity {
  const days = rangeDays(range);
  if (days <= 2) return 'hour';
  if (days <= 45) return 'day';
  if (days <= 210) return 'week';
  return 'month';
}

/**
 * Una granularidad es utilizable cuando genera suficientes puntos para leer una
 * tendencia y no tantos que el eje se vuelva ilegible.
 */
export function isGranularityUsable(
  granularity: MetricsGranularity,
  range: IsoRange,
): boolean {
  const days = rangeDays(range);
  switch (granularity) {
    case 'hour':
      return days <= 7;
    case 'day':
      return days <= 120;
    case 'week':
      return days >= 14;
    case 'month':
      return days >= 60;
  }
}

/** Ajusta la granularidad al rango cuando la elegida deja de ser legible. */
export function coerceGranularity(
  granularity: MetricsGranularity,
  range: IsoRange,
): MetricsGranularity {
  return isGranularityUsable(granularity, range) ? granularity : recommendedGranularity(range);
}

const dayFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** Etiqueta legible del rango: "01 mar 2026 – 28 mar 2026". */
export function formatRangeLabel(range: IsoRange): string {
  const from = new Date(range.from);
  // `to` es exclusivo: se muestra el último día realmente incluido.
  const lastDay = new Date(Date.parse(range.to) - DAY_MS);
  const start = dayFormatter.format(from);
  const end = dayFormatter.format(lastDay);
  return start === end ? start : `${start} – ${end}`;
}

/** Valor para `<input type="date">` (YYYY-MM-DD) en hora local. */
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Construye un rango a partir de dos valores `YYYY-MM-DD` del formulario. */
export function fromDateInputValues(fromValue: string, toValue: string): IsoRange | null {
  const from = new Date(`${fromValue}T00:00:00`);
  const to = new Date(`${toValue}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() < from.getTime()) return null;
  // El día final se incluye completo.
  return { from: from.toISOString(), to: addDays(to, 1).toISOString() };
}

/** Valida un rango recibido por URL. */
export function parseIsoRange(from: string | null, to: string | null): IsoRange | null {
  if (!from || !to) return null;
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (Number.isNaN(fromTime) || Number.isNaN(toTime) || toTime <= fromTime) return null;
  return { from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString() };
}
