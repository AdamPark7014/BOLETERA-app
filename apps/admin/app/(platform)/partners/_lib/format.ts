const DAY_MS = 24 * 60 * 60 * 1000;

const integerFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

const dayFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

/** Fecha corta ("14 mar 2026"). Devuelve "—" ante entradas inválidas. */
export function formatDay(value: string | number | Date | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dayFormatter.format(date);
}

/**
 * Antigüedad relativa en pasado. `now` se recibe como parámetro (en vez de
 * leer `Date.now()`) para que la vista pueda refrescar todas las etiquetas con
 * un solo tick y para que el resultado sea determinista en pruebas.
 */
export function relativePast(value: string | null, now: number): string {
  if (!value) return 'Sin uso';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';

  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'Ahora mismo';
  if (minutes < 60) return `Hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days < 30) return `Hace ${days} d`;

  const months = Math.round(days / 30);
  return months < 12 ? `Hace ${months} m` : `Hace ${Math.round(months / 12)} a`;
}

/** Cuenta atrás hasta una caducidad. Negativo = ya vencida. */
export function relativeFuture(days: number): string {
  if (days < 0) return `Venció hace ${Math.abs(days)} d`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  if (days < 60) return `Vence en ${days} d`;
  return `Vence en ${Math.round(days / 30)} meses`;
}

/** Días enteros entre `now` y una fecha futura. */
export function daysUntil(value: string | null, now: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((time - now) / DAY_MS);
}
