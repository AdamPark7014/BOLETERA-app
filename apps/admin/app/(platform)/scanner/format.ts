const numberFmt = new Intl.NumberFormat('es-MX');
const percentFmt = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const timeFmt = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  hour: '2-digit',
  minute: '2-digit',
});
const dayHourFmt = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const relativeFmt = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

export function formatCount(value: number): string {
  return numberFmt.format(Math.round(value));
}

export function formatRate(ratio: number | null): string {
  if (ratio === null || Number.isNaN(ratio)) return '—';
  return percentFmt.format(ratio);
}

export function formatPercentPoints(value: number): string {
  return `${numberFmt.format(Math.round(value * 10) / 10)} %`;
}

export function formatThroughput(perMin: number): string {
  if (!Number.isFinite(perMin)) return '—';
  return numberFmt.format(Math.round(perMin * 10) / 10);
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatBucketLabel(iso: string, granularity: 'hour' | 'day'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return granularity === 'day' ? dayHourFmt.format(date).split(',')[0] ?? iso : timeFmt.format(date);
}

export function formatRelative(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.round((then - now) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 60) return relativeFmt.format(deltaSec, 'second');
  if (abs < 3600) return relativeFmt.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86_400) return relativeFmt.format(Math.round(deltaSec / 3600), 'hour');
  return relativeFmt.format(Math.round(deltaSec / 86_400), 'day');
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return timeFmt.format(date);
}
