/**
 * Formateadores es-MX construidos sobre `Intl`. Sin dependencias externas.
 * Las instancias se memorizan porque construir un `Intl.NumberFormat` es caro
 * y los charts formatean cientos de etiquetas por render.
 */

const LOCALE = 'es-MX';

const numberCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

/** Formatea un numero con separadores de miles es-MX. */
export function formatNumber(value: number, fractionDigits = 0): string {
  return numberFormatter({
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Formatea un importe en pesos mexicanos. */
export function formatCurrency(value: number, fractionDigits = 2): string {
  return numberFormatter({
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Formatea una proporcion (0.153 -> "15.3 %"). */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  return numberFormatter({
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

/**
 * Abrevia magnitudes grandes para ejes y KPIs: 1_250_000 -> "1.3 M".
 * Por debajo de mil devuelve el numero completo.
 */
export function formatCompact(value: number): string {
  return numberFormatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = dateCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALE, options);
    dateCache.set(key, formatter);
  }
  return formatter;
}

/** Acepta `Date`, timestamp o cadena ISO y devuelve un `Date` valido o `null`. */
export function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fecha y hora cortas: "12 mar 2026, 19:40". */
export function formatDateTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Solo la hora: "19:40". */
export function formatTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({ hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Dia completo para agrupadores: "jueves, 12 de marzo de 2026". */
export function formatDayLabel(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  );
}

/** Formatea la variacion de un KPI con signo explicito: 0.082 -> "+8.2 %". */
export function formatDelta(ratio: number, fractionDigits = 1): string {
  const formatted = formatPercent(Math.abs(ratio), fractionDigits);
  if (ratio > 0) return `+${formatted}`;
  if (ratio < 0) return `\u2212${formatted}`;
  return formatted;
}
