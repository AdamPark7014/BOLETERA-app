import type {
  ResolvedVenueScene,
  ProjectedScene2D,
  ProjectedScene3D,
  ProjectedSeat3D,
  SectionPlate3D,
} from './types';

/** Project resolved geometry into SVG/plan drawables (identity in map space). */
export function projectTo2D(scene: ResolvedVenueScene): ProjectedScene2D {
  return {
    seats: scene.seats.map((s) => ({
      id: s.id,
      sectionId: s.sectionId,
      levelId: s.levelId,
      x: s.x,
      y: s.y,
      rotation: s.rotation ?? s.rotation3d.y,
      label: s.label,
      row: s.row,
      color: s.sectionColor,
      tier: s.tier,
      visibility: s.visibility,
    })),
    sections: scene.sections,
    stage: scene.stage,
    aisles: scene.aisles,
    obstacles: scene.obstacles,
    stairs: scene.stairs,
    exits: scene.exits,
    furniture: scene.furniture,
    bounds: scene.bounds,
  };
}

export type ProjectTo3DOptions = {
  maxSeats?: number;
  /** Target world size for the longer plan axis */
  worldSpan?: number;
  /**
   * Fallback elevation per row index when seats lack authored elevation
   * (already applied in resolve; kept as scale factor for world Y).
   */
  elevationScale?: number;
};

/** Shared plan→world frame so overlays stay aligned with projected seats. */
export type PlanProjectionFrame = {
  scale: number;
  cx: number;
  cy: number;
  elevScale: number;
  minY: number;
  maxY: number;
};

export function getPlanProjectionFrame(
  scene: ResolvedVenueScene,
  opts?: ProjectTo3DOptions
): PlanProjectionFrame | null {
  const max = opts?.maxSeats ?? 1200;
  const worldSpan = opts?.worldSpan ?? 13;
  const elevScale = opts?.elevationScale ?? 0.01;
  const list = scene.seats.slice(0, max);
  if (list.length < 1) return null;

  const xs = list.map((s) => s.x);
  const ys = list.map((s) => s.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const scale = worldSpan / Math.max(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { scale, cx, cy, elevScale, minY, maxY };
}

export function mapPointToWorld3D(
  frame: PlanProjectionFrame,
  x: number,
  y: number,
  elevY = 0.08
): [number, number, number] {
  return [(x - frame.cx) * frame.scale, elevY, (y - frame.cy) * frame.scale];
}

/**
 * Uniform plan projection: map (x,y) → world (px,pz), elevation → py.
 * Does not invent bowl wedges — visualization must not re-layout.
 */
export function projectTo3D(
  scene: ResolvedVenueScene,
  opts?: ProjectTo3DOptions
): ProjectedScene3D {
  const frame = getPlanProjectionFrame(scene, opts);

  if (!frame) {
    return {
      seats: [],
      plates: [],
      stageZ: -6.6,
      aisles: [],
      obstacles: [],
      stairs: [],
      exits: [],
      furniture: [],
      focusPoints: [],
    };
  }

  const { scale, cx, cy, elevScale, minY } = frame;
  const max = opts?.maxSeats ?? 1200;
  const list = scene.seats.slice(0, max);

  const stage = scene.stage;
  const stageWorld = stage
    ? {
        x: (stage.x + stage.width / 2 - cx) * scale,
        y: (stage.elevation ?? 0) * elevScale + 0.35,
        z: (stage.y - cy) * scale,
        width: stage.width * scale,
        depth: Math.max(1.2, stage.width * scale * 0.22),
        rotation: ((stage.rotation ?? 0) * Math.PI) / 180,
      }
    : undefined;

  const stageZ = stageWorld?.z ?? (minY - cy) * scale - 1.4;
  const stageTarget = stageWorld ? { x: stageWorld.x, z: stageWorld.z } : { x: 0, z: stageZ };

  const bySection = new Map<string, typeof list>();
  for (const s of list) {
    const arr = bySection.get(s.sectionId) ?? [];
    arr.push(s);
    bySection.set(s.sectionId, arr);
  }

  const plates: SectionPlate3D[] = [];
  const seats: ProjectedSeat3D[] = [];

  Array.from(bySection.entries()).forEach(([key, group], secIdx) => {
    const color = group[0]?.sectionColor ?? '#737373';
    const gxs = group.map((s) => s.x);
    const gys = group.map((s) => s.y);
    const gMinX = Math.min(...gxs);
    const gMaxX = Math.max(...gxs);
    const gMinY = Math.min(...gys);
    const gMaxY = Math.max(...gys);
    const gcx = (gMinX + gMaxX) / 2;
    const gcy = (gMinY + gMaxY) / 2;

    plates.push({
      name: group[0]?.sectionName ?? key,
      color,
      levelId: group[0]?.levelId,
      center: [(gcx - cx) * scale, 0.04, (gcy - cy) * scale],
      width: Math.max((gMaxX - gMinX) * scale, 1.2),
      depth: Math.max((gMaxY - gMinY) * scale, 1.0),
      rotY: 0,
      height: 0.1,
    });

    for (const seat of group) {
      const px = (seat.x - cx) * scale;
      const pz = (seat.y - cy) * scale;
      const authoredElev = seat.elevation ?? seat.position.y;
      const py = 0.16 + authoredElev * elevScale;

      const yawDeg = seat.rotation3d.y;
      const hasAuthoredYaw = seat.rotation != null || seat.rotation3d.y !== 0;
      const rotY =
        hasAuthoredYaw && Number.isFinite(yawDeg)
          ? (yawDeg * Math.PI) / 180
          : Math.atan2(px - stageTarget.x, pz - stageTarget.z);
      const rotX = ((seat.rotation3d.x || 0) * Math.PI) / 180;
      const rotZ = ((seat.rotation3d.z || 0) * Math.PI) / 180;

      seats.push({
        id: seat.id,
        label: seat.label,
        section: seat.sectionName,
        row: seat.row,
        color,
        tier: seat.tier,
        levelId: seat.levelId,
        px,
        py,
        pz,
        rotX,
        rotY,
        rotZ,
        rowIndex: seat.rowIndex,
        sectionIndex: secIdx,
        visibility: seat.visibility,
      });
    }
  });

  const aisles = scene.aisles.map((a) => ({
    id: a.id,
    width: a.width,
    levelId: a.levelId,
    points: a.points.map(
      ([x, y]) => [(x - cx) * scale, 0.02, (y - cy) * scale] as [number, number, number]
    ),
  }));

  const obstacles = scene.obstacles.map((o) => ({
    id: o.id,
    type: o.type,
    height: o.height ?? 1.2,
    levelId: o.levelId,
    points: o.points.map(
      ([x, y]) => [(x - cx) * scale, 0.02, (y - cy) * scale] as [number, number, number]
    ),
  }));

  const stairs = scene.stairs.map((s) => ({
    id: s.id,
    kind: s.kind ?? 'stairs',
    width: s.width,
    fromLevelId: s.fromLevelId,
    toLevelId: s.toLevelId,
    points: s.points.map(
      ([x, y]) => [(x - cx) * scale, 0.04, (y - cy) * scale] as [number, number, number]
    ),
  }));

  const exits = scene.exits.map((e) => ({
    id: e.id,
    label: e.label,
    width: e.width,
    levelId: e.levelId,
    points: e.points.map(
      ([x, y]) => [(x - cx) * scale, 0.05, (y - cy) * scale] as [number, number, number]
    ),
  }));

  const furniture = (scene.furniture ?? []).map((f) => {
    const elev = f.type === 'led' ? 1.4 : f.type === 'speaker' ? 0.9 : 0.55;
    return {
      id: f.id,
      type: f.type,
      label: f.type,
      rotation: f.rotation,
      levelId: f.levelId,
      position: [(f.x - cx) * scale, elev, (f.y - cy) * scale] as [number, number, number],
    };
  });

  const defaultFocusZ = (stage?.elevation ?? 40) * elevScale + 1.1;
  const focusPoints = (scene.map.venue?.focusPoints ?? []).map((f) => ({
    id: f.id,
    label: f.label,
    levelId: f.levelId,
    position: [
      (f.x - cx) * scale,
      f.z != null && Number.isFinite(f.z) ? f.z * elevScale + 0.35 : defaultFocusZ,
      (f.y - cy) * scale,
    ] as [number, number, number],
  }));

  return {
    seats,
    plates,
    stageZ,
    stage: stageWorld,
    aisles,
    obstacles,
    stairs,
    exits,
    furniture,
    focusPoints,
  };
}
