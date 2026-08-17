import type { BadgeTone } from '@boletera/ui';
import type { EgressOverviewVenue } from '@/lib/platform-api';
import type { VenueRow } from '@/lib/queries/venues';
import {
  toCapacity,
  toCity,
  type HealthStatus,
  type VenuePortfolioRow,
} from './types';

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: 'Saludable',
  warn: 'Alerta',
  critical: 'Crítico',
  'no-network': 'Sin red',
  empty: 'Sin mapa',
};

export function healthTone(status: HealthStatus | null): BadgeTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'critical':
      return 'danger';
    case 'no-network':
      return 'neutral';
    case 'empty':
      return 'info';
    default:
      return 'neutral';
  }
}

export function healthRank(status: HealthStatus | null): number {
  switch (status) {
    case 'critical':
      return 5;
    case 'warn':
      return 4;
    case 'no-network':
      return 3;
    case 'empty':
      return 2;
    case 'ok':
      return 1;
    default:
      return 0;
  }
}

export function formatCapacity(value: number): string {
  return value.toLocaleString('es-MX');
}

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatClearance(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  return `${minutes.toLocaleString('es-MX', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })} min`;
}

export function venueMatchesQuery(row: VenuePortfolioRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.name.toLowerCase().includes(q) ||
    row.slug.toLowerCase().includes(q) ||
    row.city.toLowerCase().includes(q)
  );
}

export function buildPortfolioRows(
  venues: readonly VenueRow[],
  egressByVenueId: ReadonlyMap<string, EgressOverviewVenue>,
): VenuePortfolioRow[] {
  return venues.map((venue) => {
    const layouts = venue.layouts ?? [];
    const active = layouts[0];
    const egress = egressByVenueId.get(venue.id);
    const hasActiveMap = Boolean(active?.id || egress?.layoutId);
    return {
      id: venue.id,
      name: venue.name,
      slug: venue.slug,
      city: toCity(venue),
      capacity: toCapacity(venue),
      events: venue._count?.events ?? 0,
      mapCount: layouts.length > 0 ? layouts.length : egress?.layoutId ? 1 : 0,
      hasActiveMap,
      layoutUpdatedAt: active?.updatedAt ?? null,
      layoutVersion: active?.version ?? null,
      health: egress?.status ?? null,
      healthReason: egress?.statusReason ?? null,
      sections: egress?.sections ?? null,
      unreachable: egress?.unreachable ?? null,
      clearanceMinutes: egress?.clearanceMinutes ?? null,
      seatsWithPath: egress?.seatsWithPath ?? null,
      seatsWithoutPath: egress?.seatsWithoutPath ?? null,
    };
  });
}

export function countSeatMapSeats(sections: readonly { seats?: readonly unknown[] }[]): number {
  return sections.reduce((sum, section) => sum + (section.seats?.length ?? 0), 0);
}
