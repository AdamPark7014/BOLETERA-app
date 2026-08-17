import type { SettlementPeriod } from './types';

export type PeriodRange = {
  from: string;
  to: string;
  /** Etiqueta legible del rango, p. ej. "1 – 31 de julio". */
  label: string;
  /** Granularidad recomendada para las series del periodo. */
  granularity: 'hour' | 'day';
};

export const PERIOD_OPTIONS: ReadonlyArray<{
  value: SettlementPeriod;
  label: string;
}> = [
  { value: 'DAILY', label: 'Hoy' },
  { value: 'WEEKLY', label: 'Semana' },
  { value: 'MONTHLY', label: 'Mes' },
];

export function isSettlementPeriod(value: string): value is SettlementPeriod {
  return value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY';
}

const rangeLabelFormatter = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'long',
});

/**
 * Reproduce exactamente las ventanas que usa el backend en
 * `generateSettlementReport`, para que el reporte de liquidación y las métricas
 * de settlements describan el mismo periodo y la conciliación sea comparable.
 */
export function periodRange(period: SettlementPeriod, now = new Date()): PeriodRange {
  if (period === 'DAILY') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: rangeLabelFormatter.format(from),
      granularity: 'hour',
    };
  }

  if (period === 'WEEKLY') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    const lastDay = new Date(to.getTime() - 1);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${rangeLabelFormatter.format(from)} – ${rangeLabelFormatter.format(lastDay)}`,
      granularity: 'day',
    };
  }

  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastDay = new Date(to.getTime() - 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: `${rangeLabelFormatter.format(from)} – ${rangeLabelFormatter.format(lastDay)}`,
    granularity: 'day',
  };
}

const dayFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const hourFormatter = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDay(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  return date ? dayFormatter.format(date) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

export function formatBucketLabel(
  value: string,
  granularity: 'hour' | 'day' | 'week' | 'month',
): string {
  const date = toValidDate(value);
  if (!date) return value;
  return granularity === 'hour' ? hourFormatter.format(date) : dayFormatter.format(date);
}

export function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Días completos transcurridos entre `value` y `now` (negativo si es futuro). */
export function daysSince(value: string | Date | null | undefined, now = new Date()): number | null {
  const date = toValidDate(value);
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}
