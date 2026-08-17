import type { InventoryMetrics, InventoryZoneRow } from '@boletera/shared';
import type {
  InventoryEventOption,
  InventoryZoneTableRow,
  PressureLevel,
} from './types';

export function pressureOf(row: InventoryZoneRow): PressureLevel {
  const holdRatio = row.totalQuantity > 0 ? row.holdQuantity / row.totalQuantity : 0;
  const soldRatio = row.totalQuantity > 0 ? row.soldQuantity / row.totalQuantity : 0;
  const days = row.daysToSellOut;

  if (holdRatio >= 0.25 || (days != null && days <= 2 && soldRatio >= 0.7)) return 'critical';
  if (holdRatio >= 0.12 || (days != null && days <= 7 && soldRatio >= 0.55)) return 'high';
  if (soldRatio >= 0.35 || holdRatio >= 0.05) return 'medium';
  return 'low';
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

export function buildEventOptions(rows: readonly InventoryZoneTableRow[]): InventoryEventOption[] {
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
      });
      continue;
    }
    current.zones += 1;
    current.held += row.holdQuantity;
    current.available += row.remainingQuantity;
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
  };
}

function shortenLabel(zone: string, eventTitle: string): string {
  const event = eventTitle.length > 18 ? `${eventTitle.slice(0, 16)}…` : eventTitle;
  return `${zone} · ${event}`;
}
