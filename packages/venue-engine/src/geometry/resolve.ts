import type {
  SeatMapBounds,
  SeatMapData,
  SeatMapExit,
  SeatMapSeat,
  SeatMapVenueMeta,
  SeatVisibility,
} from '@boletera/shared';
import { generateBlock } from './generators';
import { migrateToV3 } from './migrate';
import type { ResolvedSeat, ResolvedSection, ResolvedVenueScene } from './types';

/**
 * Authored exits, or furniture doors when no exits were authored.
 */
export function resolveExits(venue: SeatMapVenueMeta | undefined): SeatMapExit[] {
  const authored = venue?.exits ?? [];
  if (authored.length) return authored;
  const doors = (venue?.furniture ?? []).filter((f) => f.type === 'door');
  return doors.map((d, i) => ({
    id: `door-exit-${d.id || i}`,
    points: [[d.x, d.y]] as [number, number][],
    label: `Puerta ${i + 1}`,
    width: 32,
  }));
}

function boundsFromMap(map: SeatMapData, padding = 24): SeatMapBounds {
  const seats = map.sections.flatMap((s) => s.seats);
  if (!seats.length) {
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

function emptyVisibility(): SeatVisibility {
  return {};
}

function rowIndexForSeat(seats: SeatMapSeat[], seat: SeatMapSeat): number {
  const labels = new Map<string, number>();
  const sorted = [...seats].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > 0.5) return dy;
    return a.x - b.x;
  });
  let lastY: number | null = null;
  let band = -1;
  for (const s of sorted) {
    if (lastY == null || Math.abs(s.y - lastY) > 10) {
      band += 1;
      lastY = s.y;
    }
    if (s.row) {
      if (!labels.has(s.row)) labels.set(s.row, labels.size);
    }
  }
  if (seat.row && labels.has(seat.row)) return labels.get(seat.row)!;

  lastY = null;
  band = -1;
  for (const s of sorted) {
    if (lastY == null || Math.abs(s.y - lastY) > 10) {
      band += 1;
      lastY = s.y;
    }
    if (s.id === seat.id) return Math.max(0, band);
  }
  return 0;
}

function resolveSeatPose(
  seat: SeatMapSeat,
  section: { rake?: number; levelId?: string },
  rowIndex: number,
  levelElevation = 0
): Pick<
  ResolvedSeat,
  'position' | 'rotation3d' | 'elevation' | 'x' | 'y' | 'rotation' | 'coord3d'
> {
  const yaw = seat.rotation3d?.y ?? seat.rotation ?? 0;
  const pitch =
    seat.rotation3d?.x ??
    seat.coord3d?.pitch ??
    (section.rake ? Math.min(18, section.rake * 2.2) : 0);
  const roll = seat.rotation3d?.z ?? seat.coord3d?.roll ?? 0;

  let elevation =
    seat.elevation ??
    seat.position?.y ??
    seat.coord3d?.y ??
    (section.rake != null ? rowIndex * section.rake : rowIndex * 12);

  elevation += levelElevation;

  let position = seat.position;
  if (!position && seat.coord3d) {
    position = { x: seat.coord3d.x, y: seat.coord3d.y + levelElevation, z: seat.coord3d.z };
    elevation = position.y;
  }
  if (!position) {
    position = { x: seat.x, y: elevation, z: seat.y };
  } else if (levelElevation && seat.position) {
    position = { ...position, y: elevation };
  }

  const rotation3d = { x: pitch, y: yaw, z: roll };
  return {
    x: seat.x,
    y: seat.y,
    rotation: yaw,
    elevation,
    position,
    rotation3d,
    coord3d: {
      x: position.x,
      y: position.y,
      z: position.z,
      pitch,
      roll,
    },
  };
}

/**
 * Blueprint → resolved spatial scene.
 * If a section has `blocks` and empty/missing seats, seats are generated from blocks.
 * Existing authored seats keep their plan coords; missing Z/elevation is filled via rake.
 */
export function resolveGeometry(raw: unknown): ResolvedVenueScene {
  const migrated = migrateToV3(raw);
  const sectionsOut: ResolvedSection[] = [];
  const seatsOut: ResolvedSeat[] = [];

  const mapSections = migrated.sections.map((sec) => {
    let seats = sec.seats;
    if (sec.blocks?.length && seats.length === 0) {
      seats = sec.blocks.flatMap((block) =>
        generateBlock({
          ...block,
          rake: block.rake ?? sec.rake,
          seatPitch: block.seatPitch || sec.seatPitch || 26,
          rowPitch: block.rowPitch || sec.rowPitch || 28,
          curvature: block.curvature ?? sec.curvature,
        })
      );
    }
    return { ...sec, seats };
  });

  const map: SeatMapData = {
    ...migrated,
    version: 3,
    sections: mapSections,
  };

  const venue = map.venue ?? {};
  const levelElev = new Map((venue.levels ?? []).map((l) => [l.id, l.elevation] as const));

  mapSections.forEach((sec) => {
    const seatIds: string[] = [];
    const baseElev = levelElev.get(sec.levelId ?? '') ?? 0;
    sec.seats.forEach((seat) => {
      const rowIndex = rowIndexForSeat(sec.seats, seat);
      const seatLevelElev = levelElev.get(seat.levelId ?? '') ?? baseElev;
      const pose = resolveSeatPose(seat, sec, rowIndex, seatLevelElev);
      const resolved: ResolvedSeat = {
        ...seat,
        ...pose,
        levelId: seat.levelId ?? sec.levelId,
        sectionId: sec.id,
        sectionName: sec.name,
        sectionColor: sec.color,
        rowIndex,
        visibility: seat.visibility ?? emptyVisibility(),
      };
      seatsOut.push(resolved);
      seatIds.push(seat.id);
    });
    sectionsOut.push({
      id: sec.id,
      name: sec.name,
      slug: sec.slug,
      color: sec.color,
      shape: sec.shape,
      rake: sec.rake,
      seatPitch: sec.seatPitch,
      rowPitch: sec.rowPitch,
      curvature: sec.curvature,
      levelId: sec.levelId,
      seatIds,
    });
  });

  const bounds = boundsFromMap(map);
  if (!map.viewport) {
    map.viewport = {
      width: bounds.width,
      height: bounds.height,
      minX: bounds.minX,
      minY: bounds.minY,
    };
  }

  return {
    version: 3,
    seats: seatsOut,
    sections: sectionsOut,
    stage: venue.stage,
    aisles: venue.aisles ?? [],
    obstacles: venue.obstacles ?? [],
    stairs: venue.stairs ?? [],
    exits: resolveExits(venue),
    furniture: venue.furniture ?? [],
    levels: venue.levels ?? [],
    bounds,
    units: venue.units ?? 'map',
    scale: venue.scale ?? 1,
    map,
  };
}

/** Flatten resolved scene back into SeatMapData v3 for save/publish. */
export function sceneToSeatMapData(scene: ResolvedVenueScene): SeatMapData {
  const bySection = new Map<string, ResolvedSeat[]>();
  for (const seat of scene.seats) {
    const arr = bySection.get(seat.sectionId) ?? [];
    arr.push(seat);
    bySection.set(seat.sectionId, arr);
  }

  return {
    version: 3,
    viewport: scene.map.viewport,
    venue: {
      ...(scene.map.venue ?? {}),
      stage: scene.stage,
      aisles: scene.aisles,
      obstacles: scene.obstacles,
      stairs: scene.stairs,
      exits: scene.map.venue?.exits ?? scene.exits.filter((e) => !e.id.startsWith('door-exit-')),
      furniture: scene.furniture,
      levels: scene.levels,
      units: scene.units,
      scale: scene.scale,
    },
    sections: scene.sections.map((sec) => {
      const original = scene.map.sections.find((s) => s.id === sec.id);
      const seats = (bySection.get(sec.id) ?? []).map((s) => {
        const { sectionId: _a, sectionName: _b, sectionColor: _c, rowIndex: _d, ...rest } = s;
        return rest;
      });
      return {
        id: sec.id,
        name: sec.name,
        slug: sec.slug,
        color: sec.color,
        shape: sec.shape,
        blocks: original?.blocks,
        rake: sec.rake,
        seatPitch: sec.seatPitch,
        rowPitch: sec.rowPitch,
        curvature: sec.curvature,
        seats,
      };
    }),
  };
}
