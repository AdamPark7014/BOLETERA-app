import type { SeatMapBounds, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import { migrateToV3 } from './geometry/migrate';

export function findSeatById(map: SeatMapData, seatId: string): SeatMapSeat | undefined {
  for (const section of map.sections) {
    const seat = section.seats.find((s) => s.id === seatId);
    if (seat) return seat;
  }
  return undefined;
}

export function seatToViewCoords(seat: SeatMapSeat): { x: number; y: number; z: number } {
  if (seat.position) return seat.position;
  if (seat.coord3d) return { x: seat.coord3d.x, y: seat.coord3d.y, z: seat.coord3d.z };
  const elev = seat.elevation ?? 0.5;
  return { x: seat.x / 100, y: elev, z: seat.y / 100 };
}

export function buildAvailabilityMap(
  seats: { id: string; status: string }[]
): Record<string, string> {
  return Object.fromEntries(seats.map((s) => [s.id, s.status]));
}

export function computeMapBounds(map: SeatMapData, padding = 24): SeatMapBounds {
  const seats = map.sections.flatMap((s) => s.seats);
  const shapePts = map.sections.flatMap((s) => s.shape?.points ?? []);
  const aislePts = map.venue?.aisles?.flatMap((a) => a.points) ?? [];
  const obstaclePts = map.venue?.obstacles?.flatMap((o) => o.points) ?? [];
  const stairPts = map.venue?.stairs?.flatMap((s) => s.points) ?? [];
  const extras = [...shapePts, ...aislePts, ...obstaclePts, ...stairPts];

  if (!seats.length && !extras.length) {
    return { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of seats) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  for (const [x, y] of extras) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (map.venue?.stage) {
    const st = map.venue.stage;
    minX = Math.min(minX, st.x);
    minY = Math.min(minY, st.y);
    maxX = Math.max(maxX, st.x + st.width);
    maxY = Math.max(maxY, st.y + 40);
  }
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 80),
    height: Math.max(maxY - minY, 80),
  };
}

export function sectionBounds(section: SeatMapSection, padding = 16): SeatMapBounds {
  return computeMapBounds({ sections: [section], version: 3 }, padding);
}

/** Normalize legacy snapshots into SeatMapData v3 (spatial engine). */
export function normalizeSeatMap(raw: unknown): SeatMapData {
  const migrated = migrateToV3(raw);
  const bounds = computeMapBounds(migrated);
  const viewport = {
    width: migrated.viewport?.width ?? bounds.width,
    height: migrated.viewport?.height ?? bounds.height,
    minX: migrated.viewport?.minX ?? bounds.minX,
    minY: migrated.viewport?.minY ?? bounds.minY,
  };
  return {
    ...migrated,
    version: 3,
    viewport,
  };
}

export function flatSeats(map: SeatMapData): Array<
  SeatMapSeat & {
    sectionId: string;
    sectionName: string;
    sectionColor: string;
    levelId?: string;
  }
> {
  return map.sections.flatMap((sec) =>
    sec.seats.map((s) => ({
      ...s,
      sectionId: sec.id,
      sectionName: sec.name,
      sectionColor: sec.color,
      levelId: s.levelId ?? sec.levelId,
    }))
  );
}
