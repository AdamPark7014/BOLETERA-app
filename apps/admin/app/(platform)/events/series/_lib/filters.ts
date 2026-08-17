import type { EventSeriesKind, EventSeriesStatus, SeriesRow } from '@/lib/scheduling-api';

export type SeriesTab = 'catalogo' | 'crear-serie' | 'crear-residencia';

export type SeriesFilters = {
  q: string;
  kind: EventSeriesKind | 'ALL';
  status: EventSeriesStatus | 'ALL';
  tab: SeriesTab;
};

const TABS: readonly SeriesTab[] = ['catalogo', 'crear-serie', 'crear-residencia'];
const KINDS: readonly EventSeriesKind[] = [
  'SERIES',
  'RESIDENCY',
  'TOUR',
  'SEASON',
  'FESTIVAL',
];
const STATUSES: readonly EventSeriesStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];

export function parseFilters(params: URLSearchParams): SeriesFilters {
  const tabRaw = params.get('tab') ?? 'catalogo';
  const kindRaw = params.get('kind') ?? 'ALL';
  const statusRaw = params.get('status') ?? 'ALL';
  return {
    q: params.get('q') ?? '',
    tab: (TABS as readonly string[]).includes(tabRaw) ? (tabRaw as SeriesTab) : 'catalogo',
    kind: (KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as EventSeriesKind)
      : 'ALL',
    status: (STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as EventSeriesStatus)
      : 'ALL',
  };
}

export function filtersToParams(filters: SeriesFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== 'catalogo') params.set('tab', filters.tab);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.kind !== 'ALL') params.set('kind', filters.kind);
  if (filters.status !== 'ALL') params.set('status', filters.status);
  return params;
}

export function filterSeries(rows: SeriesRow[], filters: SeriesFilters): SeriesRow[] {
  const q = filters.q.trim().toLocaleLowerCase('es-MX');
  return rows.filter((row) => {
    if (filters.kind !== 'ALL' && row.kind !== filters.kind) return false;
    if (filters.status !== 'ALL' && row.status !== filters.status) return false;
    if (!q) return true;
    const haystack = [
      row.name,
      row.venue?.name ?? '',
      row.summary ?? '',
      row.kind,
      row.status,
    ]
      .join(' ')
      .toLocaleLowerCase('es-MX');
    return haystack.includes(q);
  });
}

export function seriesKpis(rows: SeriesRow[]) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === 'ACTIVE').length,
    upcomingDates: rows.reduce((sum, row) => sum + row.totals.upcoming, 0),
    capacity: rows.reduce((sum, row) => sum + row.totals.capacity, 0),
  };
}
