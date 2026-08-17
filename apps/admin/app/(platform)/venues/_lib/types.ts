import type { EgressOverviewVenue } from '@/lib/platform-api';
import type { VenueRow } from '@/lib/queries/venues';

export type HealthStatus = EgressOverviewVenue['status'];

export type MapFilter = 'with' | 'without';

export type ViewMode = 'table' | 'cards';

export type VenuePortfolioRow = {
  id: string;
  name: string;
  slug: string;
  city: string;
  capacity: number;
  events: number;
  mapCount: number;
  hasActiveMap: boolean;
  layoutUpdatedAt: string | null;
  layoutVersion: number | null;
  health: HealthStatus | null;
  healthReason: string | null;
  sections: number | null;
  unreachable: number | null;
  clearanceMinutes: number | null;
  seatsWithPath: number | null;
  seatsWithoutPath: number | null;
  [key: string]: string | number | boolean | HealthStatus | null;
};

export function toCapacity(venue: VenueRow): number {
  const raw = venue.totalCapacity ?? venue.capacity;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function toCity(venue: VenueRow): string {
  return venue.city?.trim() || 'Sin ciudad';
}
