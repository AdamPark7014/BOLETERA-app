/** Importe en centavos. Siempre entero. */
export type Cents = number;

const CENTS_PER_UNIT = 100;

export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * CENTS_PER_UNIT);
}

export function centsToUnits(cents: Cents): number {
  return cents / CENTS_PER_UNIT;
}

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const preciseCurrencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  maximumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 0,
});

export function formatMoney(cents: Cents): string {
  return currencyFormatter.format(centsToUnits(cents));
}

export function formatMoneyPrecise(cents: Cents): string {
  return preciseCurrencyFormatter.format(centsToUnits(cents));
}

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return percentFormatter.format(ratio);
}

export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}
