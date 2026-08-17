import type { SeatMapData } from '@boletera/shared';
import {
  flatSeats,
  normalizeSeatMap,
  priceHeatColor,
  SEAT_STATUS_COLORS,
  sightlineHeatColor,
  type SightlineResult,
} from '@boletera/venue-engine';
import { sectionColor, type Seat3D } from '@boletera/venue-3d';
import type { LayerVisibility, StageDraft, StudioColorMode, StudioSeat } from './types';

const TIER_PALETTE = [
  '#5b9fd4',
  '#d4a017',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#64748b',
];

function tierColor(tier: string): string {
  let h = 0;
  for (let i = 0; i < tier.length; i++) h = (h * 31 + tier.charCodeAt(i)) >>> 0;
  return TIER_PALETTE[h % TIER_PALETTE.length] ?? TIER_PALETTE[0];
}

function statusColor(status: StudioSeat['status']): string {
  switch (status) {
    case 'sold':
      return SEAT_STATUS_COLORS.sold;
    case 'held':
      return SEAT_STATUS_COLORS.held;
    case 'blocked':
      return SEAT_STATUS_COLORS.dimmed;
    default:
      return SEAT_STATUS_COLORS.available;
  }
}

export function normalizeMap(mapData: SeatMapData | null | undefined): SeatMapData | null {
  if (!mapData) return null;
  return normalizeSeatMap(mapData);
}

export function mapToStudioSeats(map: SeatMapData): StudioSeat[] {
  return flatSeats(map).map((seat) => {
    const blocked = Boolean(seat.visibility?.blocked);
    return {
      id: seat.id,
      label: seat.label,
      x: seat.x,
      y: seat.y,
      z: seat.position?.y ?? seat.elevation ?? 0,
      section: seat.sectionName,
      sectionId: seat.sectionId,
      row: seat.row,
      color: seat.sectionColor || sectionColor(seat.sectionName),
      rotation: seat.rotation,
      elevation: seat.elevation,
      position: seat.position,
      rotation3d: seat.rotation3d,
      coord3d: seat.coord3d,
      visibility: seat.visibility,
      status: blocked ? ('blocked' as const) : ('available' as const),
      levelId: seat.levelId,
      tier: seat.tier,
    };
  });
}

export function applyColorMode(
  seats: StudioSeat[],
  mode: StudioColorMode,
  sightlines: SightlineResult | null,
): Seat3D[] {
  const scoreById = new Map(sightlines?.scores.map((s) => [s.seatId, s]) ?? []);
  const prices = seats
    .map((s) => s.price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  return seats.map((seat) => {
    let color = seat.color || sectionColor(seat.section || seat.id);
    if (mode === 'zone') {
      color = seat.color || sectionColor(seat.section || seat.id);
    } else if (mode === 'tier') {
      color = seat.tier ? tierColor(seat.tier) : color;
    } else if (mode === 'status') {
      color = statusColor(seat.status);
    } else if (mode === 'price' && typeof seat.price === 'number') {
      color = priceHeatColor(seat.price, minPrice, maxPrice);
    } else if (mode === 'sightline') {
      const hit = scoreById.get(seat.id);
      color = hit ? sightlineHeatColor(hit.score) : SEAT_STATUS_COLORS.dimmed;
    }
    return { ...seat, color };
  });
}

export function filterSeatsByLayers(
  seats: StudioSeat[],
  layers: LayerVisibility,
  levelFilter: string | 'ALL',
): StudioSeat[] {
  return seats.filter((seat) => {
    if (levelFilter !== 'ALL' && seat.levelId && seat.levelId !== levelFilter) return false;
    if (seat.levelId && layers.levels[seat.levelId] === false) return false;
    return true;
  });
}

export function withStage(map: SeatMapData, stage: StageDraft): SeatMapData {
  return {
    ...map,
    venue: {
      ...map.venue,
      stage: {
        x: stage.x,
        y: stage.y,
        width: stage.width,
        rotation: stage.rotation,
        elevation: stage.elevation,
      },
    },
  };
}

export function stageFromMap(map: SeatMapData | null): StageDraft {
  const stage = map?.venue?.stage;
  return {
    x: stage?.x ?? 0,
    y: stage?.y ?? 0,
    width: stage?.width ?? 200,
    rotation: stage?.rotation ?? 0,
    elevation: stage?.elevation ?? 40,
  };
}

export function extractLevels(map: SeatMapData | null): Array<{ id: string; name: string; elevation?: number; zIndex?: number }> {
  return map?.venue?.levels ?? [];
}
