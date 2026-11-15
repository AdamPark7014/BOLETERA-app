/**
 * Formateadores es-MX construidos sobre `Intl`. Sin dependencias externas.
 * Las instancias se memorizan porque construir un `Intl.NumberFormat` es caro
 * y los charts formatean cientos de etiquetas por render.
 */

const LOCALE = 'es-MX';

/**
 * Zona horaria de toda la plataforma. Sin ella, el servidor (UTC) y el
 * navegador pintaban horas distintas y React marcaba error de hidratación.
 */
export const TIME_ZONE = 'America/Mexico_City';

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

/**
 * Importe del lenguaje visual: `$1,250.00`.
 * El menos es U+2212, pegado al peso: `−$120.00`. No añade «MXN».
 */
export function formatTicketAmount(value: number): string {
  if (!Number.isFinite(value)) return '';
  const body = numberFormatter({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  const signed = value < 0 ? `\u2212$${body}` : `$${body}`;
  return signed;
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
    formatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options });
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
    hourCycle: 'h23',
  }).format(date);
}

/** Solo la hora, reloj de 24 h: "19:40". */
export function formatTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** Dia completo para agrupadores: "jueves, 12 de marzo de 2026". */
export function formatDayLabel(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    date
  );
}

/** Formatea la variacion de un KPI con signo explicito: 0.082 -> "+8.2 %". */
export function formatDelta(ratio: number, fractionDigits = 1): string {
  const formatted = formatPercent(Math.abs(ratio), fractionDigits);
  if (ratio > 0) return `+${formatted}`;
  if (ratio < 0) return `\u2212${formatted}`;
  return formatted;
}

// ---------------------------------------------------------------------------
// Formatos de evento (Black Ticket). Un solo criterio en web, admin y taquilla:
// es-MX, America/Mexico_City, reloj de 24 h, sin puntos de abreviatura.
// ---------------------------------------------------------------------------

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clean(text: string): string {
  return text.replace(/\./g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
}

/** "Sáb 12 dic" */
export function formatEventDate(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return capitalize(
    clean(dateFormatter({ weekday: 'short', day: 'numeric', month: 'short' }).format(date))
  );
}

/** "Sáb 12 dic · 21:00" */
export function formatEventDateTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return `${formatEventDate(date)} · ${formatTime(date)}`;
}

/** "Sábado, 12 de diciembre, 21:00" */
export function formatEventLong(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  const day = dateFormatter({ weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return `${capitalize(day)}, ${formatTime(date)}`;
}

/** "12 dic" (sin día de la semana). */
export function formatDayMonth(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return clean(dateFormatter({ day: 'numeric', month: 'short' }).format(date));
}

/** "12 de diciembre de 2026" */
export function formatDateLong(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return dateFormatter({ day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** Clave AAAA-MM-DD del día en la zona de la plataforma (agrupar, comparar «hoy»). */
export function dayKey(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
}

/**
 * Rango de fechas: "12–14 dic", "30 nov – 2 dic", "12 dic 2026 – 3 ene 2027".
 * Si ambos extremos son el mismo día: "Sáb 12 dic · 19:00–23:00".
 */
export function formatDateRange(
  start: Date | string | number,
  end: Date | string | number | null | undefined
): string {
  const a = toDate(start);
  if (!a) return '';
  const b = end != null ? toDate(end) : null;
  if (!b) return formatEventDateTime(a);
  if (dayKey(a) === dayKey(b)) return `${formatEventDate(a)} · ${formatTime(a)}–${formatTime(b)}`;
  const yearA = dateFormatter({ year: 'numeric' }).format(a);
  const yearB = dateFormatter({ year: 'numeric' }).format(b);
  const monthA = dateFormatter({ month: 'short' }).format(a);
  const monthB = dateFormatter({ month: 'short' }).format(b);
  const dayA = dateFormatter({ day: 'numeric' }).format(a);
  if (yearA !== yearB) {
    return `${formatDayMonth(a)} ${yearA} – ${formatDayMonth(b)} ${yearB}`;
  }
  if (monthA === monthB) return `${dayA}–${formatDayMonth(b)}`;
  return `${formatDayMonth(a)} – ${formatDayMonth(b)}`;
}

/** Precio anunciado: "$1,250" si no hay centavos, "$1,270.08" si los hay. */
export function formatPrice(value: number): string {
  const full = formatTicketAmount(value);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}
