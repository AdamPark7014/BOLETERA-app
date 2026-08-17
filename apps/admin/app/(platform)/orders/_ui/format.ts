/**
 * Formato de dinero y fechas para las pantallas de dinero.
 *
 * Antes cada tabla hacía `${'$'}${Number(x).toLocaleString('es-MX')}`: eso pierde
 * los centavos (toLocaleString sin opciones redondea a 3 decimales máximos pero
 * no fija 2 mínimos) y sobre todo asume MXN sin decirlo. En una plataforma que
 * ya guarda `currency` por orden, un total sin moneda explícita es un reporte
 * que no se puede auditar.
 */

const MONEY_CACHE = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string): Intl.NumberFormat {
  const key = currency || 'MXN';
  let fmt = MONEY_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    MONEY_CACHE.set(key, fmt);
  }
  return fmt;
}

/** Convierte Decimal-como-string, number o null en number seguro. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `$1,234.50 MXN`. La moneda va explícita porque la plataforma opera MXN y USD
 * y un símbolo `$` a secas es ambiguo entre las dos.
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined = 'MXN',
): string {
  const code = (currency || 'MXN').toUpperCase();
  let body: string;
  try {
    body = moneyFormatter(code).format(toNumber(value));
  } catch {
    // Código de moneda desconocido: no reventar la tabla por un dato sucio.
    body = toNumber(value).toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return `${body} ${code}`;
}

/** Igual que `formatMoney` pero con signo explícito (para diferencias). */
export function formatMoneyDelta(
  value: string | number | null | undefined,
  currency: string | null | undefined = 'MXN',
): string {
  const n = toNumber(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatMoney(n, currency)}`;
}

export function formatNumber(value: string | number | null | undefined): string {
  return toNumber(value).toLocaleString('es-MX');
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-MX', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** `hace 3 min` — para el panel en vivo, donde la frescura del dato importa. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return 'ahora mismo';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return formatDateTime(d);
}

/** Diferencia relativa entre lo esperado y lo liquidado, en puntos porcentuales. */
export function differencePercent(expected: number, actual: number): number | null {
  if (!Number.isFinite(expected) || expected === 0) return null;
  return ((actual - expected) / expected) * 100;
}

/**
 * Tolerancia de centavos: las pasarelas redondean y un descuadre de $0.01 no es
 * una alerta operativa. Por encima de eso sí hay que señalarlo.
 */
export const SETTLEMENT_EPSILON = 0.01;

export function isSettlementMismatch(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) > SETTLEMENT_EPSILON;
}
