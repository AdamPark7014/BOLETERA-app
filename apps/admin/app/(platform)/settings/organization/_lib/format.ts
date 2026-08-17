import { formatDateTime } from '@boletera/ui';

const integerFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

/** Recibe una fracción (0.085 → "8.5 %"). */
export function formatCommission(rate: number | string | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  const numeric = typeof rate === 'number' ? rate : Number(rate);
  if (!Number.isFinite(numeric)) return '—';
  return percentFormatter.format(numeric);
}

export function relativeLogin(value: string | null, now: number): string {
  if (!value) return 'Nunca';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';

  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'Ahora mismo';
  if (minutes < 60) return `Hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days < 14) return `Hace ${days} d`;

  return formatDateTime(value);
}
