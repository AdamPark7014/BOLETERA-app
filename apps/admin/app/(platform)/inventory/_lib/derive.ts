import type { InventoryMetrics, InventoryZoneRow } from '@boletera/shared';
import type { EventRow } from '@/lib/platform-api';
import type { VenueRow } from '@/lib/queries/venues';
import type {
  InventoryEventOption,
  InventoryZoneTableRow,
  PressureLevel,
  SelloutRiskRow,
} from './types';

export function pressureOf(row: InventoryZoneRow): PressureLevel {
  const holdRatio = row.totalQuantity > 0 ? row.holdQuantity / row.totalQuantity : 0;
  const soldRatio = row.totalQuantity > 0 ? row.soldQuantity / row.totalQuantity : 0;
  const days = row.daysToSellOut;

  if (holdRatio >= 0.25 || (days != null && days <= 2 && soldRatio >= 0.7)) {
    return 'critical';
  }
  if (holdRatio >= 0.12 || (days != null && days <= 7 && soldRatio >= 0.55)) {
    return 'high';
  }
  if (soldRatio >= 0.35 || holdRatio >= 0.05) return 'medium';
  return 'low';
}

export function pressureRank(level: PressureLevel): number {
  switch (level) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

export function buildZoneRows(metrics: InventoryMetrics | undefined): InventoryZoneTableRow[] {
  const zones = metrics?.byZone ?? [];
  return zones
    .map((zone) => ({
      id: `${zone.eventId}:${zone.offerId}:${zone.zone}`,
      eventId: zone.eventId,
      eventTitle: zone.eventTitle,
      offerId: zone.offerId,
      zone: zone.zone,
      tierName: zone.tierName,
      totalQuantity: zone.totalQuantity,
      remainingQuantity: zone.remainingQuantity,
      soldQuantity: zone.soldQuantity,
      holdQuantity: zone.holdQuantity,
      availabilityPercent: zone.availabilityPercent,
      sellThroughVelocity: zone.sellThroughVelocity,
      daysToSellOut: zone.daysToSellOut,
      pressure: pressureOf(zone),
    }))
    .sort(
      (a, b) =>
        pressureRank(b.pressure) - pressureRank(a.pressure) ||
        b.holdQuantity - a.holdQuantity ||
        a.availabilityPercent - b.availabilityPercent,
    );
}

export function buildEventOptions(
  rows: readonly InventoryZoneTableRow[],
  events: readonly EventRow[] | undefined,
  venues: readonly VenueRow[] | undefined,
): InventoryEventOption[] {
  const venueById = new Map((venues ?? []).map((venue) => [venue.id, venue.name]));
  const eventVenue = new Map(
    (events ?? []).map((event) => [
      event.id,
      event.venue?.name ?? (event.venueId ? venueById.get(event.venueId) ?? null : null),
    ]),
  );

  const map = new Map<string, InventoryEventOption>();
  for (const row of rows) {
    const current = map.get(row.eventId);
    if (!current) {
      map.set(row.eventId, {
        id: row.eventId,
        title: row.eventTitle,
        zones: 1,
        held: row.holdQuantity,
        available: row.remainingQuantity,
        sold: row.soldQuantity,
        venueName: eventVenue.get(row.eventId) ?? null,
      });
      continue;
    }
    current.zones += 1;
    current.held += row.holdQuantity;
    current.available += row.remainingQuantity;
    current.sold += row.soldQuantity;
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'es-MX'));
}

export function zoneBarSeries(rows: readonly InventoryZoneTableRow[]) {
  const top = rows.slice(0, 8);
  return {
    available: top.map((row) => ({
      label: shortenLabel(row.zone, row.eventTitle),
      value: row.remainingQuantity,
    })),
    held: top.map((row) => ({
      label: shortenLabel(row.zone, row.eventTitle),
      value: row.holdQuantity,
    })),
    sold: top.map((row) => ({
      label: shortenLabel(row.zone, row.eventTitle),
      value: row.soldQuantity,
    })),
    blocked: top.map((row) => ({
      label: shortenLabel(row.zone, row.eventTitle),
      value: Math.max(
        0,
        row.totalQuantity - row.remainingQuantity - row.holdQuantity - row.soldQuantity,
      ),
    })),
  };
}

export function buildSelloutRisks(rows: readonly InventoryZoneTableRow[]): SelloutRiskRow[] {
  return rows
    .filter(
      (row) =>
        row.daysToSellOut != null &&
        row.daysToSellOut <= 14 &&
        row.remainingQuantity > 0 &&
        row.sellThroughVelocity > 0,
    )
    .map((row) => ({
      id: row.id,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      zone: row.zone,
      tierName: row.tierName,
      daysToSellOut: row.daysToSellOut as number,
      remainingQuantity: row.remainingQuantity,
      sellThroughVelocity: row.sellThroughVelocity,
    }))
    .sort((a, b) => a.daysToSellOut - b.daysToSellOut)
    .slice(0, 8);
}

export function statusCountValue(
  counts: Record<string, number> | undefined,
  keys: readonly string[],
): number {
  if (!counts) return 0;
  return keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

function shortenLabel(zone: string, eventTitle: string): string {
  const event = eventTitle.length > 18 ? `${eventTitle.slice(0, 16)}…` : eventTitle;
  return `${zone} · ${event}`;
}
