/** Formato fiscal MXN. Importes de CFDI en unidades → centavos al mostrar. */

export type Cents = number;

const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const integer = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

export function formatMoney(cents: Cents): string {
  return money.format(cents / 100);
}

export function formatCount(value: number): string {
  return integer.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

export function folioLabel(serie: string, folio: number): string {
  return `${serie}-${folio}`;
}
