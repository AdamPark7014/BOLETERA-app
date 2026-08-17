/**
 * Aritmética monetaria en centavos enteros (MXN).
 *
 * Los importes llegan del backend como `Decimal` serializado (string) o como
 * `number`. Sumar floats acumula error; todas las agregaciones de esta pantalla
 * se hacen sobre enteros y sólo se convierte a unidades al formatear.
 */

/** Importe en centavos. Siempre entero. */
export type Cents = number;

const CENTS_PER_UNIT = 100;

/** Convierte un importe del backend (string | number) a centavos enteros. */
export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * CENTS_PER_UNIT);
}

/** Convierte centavos a unidades para formateo o gráficas. */
export function centsToUnits(cents: Cents): number {
  return cents / CENTS_PER_UNIT;
}

/** Suma exacta de importes en centavos. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 0,
});

/** "$ 1,234.50" — precisión de dos decimales, nunca notación científica. */
export function formatMoney(cents: Cents): string {
  return currencyFormatter.format(centsToUnits(cents));
}

/** "$ 1.2 M" para ejes y etiquetas densas. */
export function formatMoneyCompact(cents: Cents): string {
  return compactCurrencyFormatter.format(centsToUnits(cents));
}

/** Importe con signo explícito, para diferencias de conciliación. */
export function formatSignedMoney(cents: Cents): string {
  if (cents === 0) return formatMoney(0);
  const sign = cents > 0 ? '+' : '\u2212';
  return `${sign}${formatMoney(Math.abs(cents))}`;
}

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

/** Recibe una proporción (0.153 → "15.3 %"). */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return percentFormatter.format(ratio);
}

/** Proporción segura: devuelve `null` cuando el denominador es cero. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}
