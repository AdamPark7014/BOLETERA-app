const integerFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

/** Valor ya en porcentaje 0–100. */
export function formatPercentPoints(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${integerFormatter.format(Math.round(value * 10) / 10)} %`;
}
