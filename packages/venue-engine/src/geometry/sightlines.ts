import type { SeatVisibility } from '@boletera/shared';
import type { ResolvedSeat, ResolvedVenueScene } from './types';

export type SightlineGrade = 'premium' | 'good' | 'fair' | 'restricted' | 'blocked';

export type SightlineScore = {
  seatId: string;
  score: number; // 0..1
  grade: SightlineGrade;
  distance: number;
  facingDot: number;
  elevationBonus: number;
  /** Plan/3D occlusion vs authored obstacles */
  occluded: boolean;
  /** Occlusion from a taller/closer row along the LOS */
  rowBlocked: boolean;
  /** Minimum C-value (eye clearance over front head) when a front seat exists; cm-ish map units */
  cValue?: number;
  /** Winning focus point id when multi-focus is used */
  focusId?: string;
  visibility: SeatVisibility;
};

export type SightlineResult = {
  scores: SightlineScore[];
  stageTarget: { x: number; y: number; z: number };
  focuses: Array<{ id: string; x: number; y: number; z: number; label?: string }>;
  summary: Record<SightlineGrade, number>;
};

export type SightlineOptions = {
  /** Eye height above seat elevation (map units). Default 12 ≈ 0.3m at scale 40 */
  eyeHeight?: number;
  /** Front spectator head height above their seat elevation. Default 14 */
  headHeight?: number;
  /** Minimum clearance over front head along LOS (C-value). Default 4 */
  minC?: number;
  /** Lateral corridor half-width for “same aisle seat” front detection. Default 18 */
  corridorHalfWidth?: number;
  /**
   * When set, only score seats on this level (untagged seats included).
   * Row occlusion also uses the same-level seat set.
   */
  levelId?: string;
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function gradeFromScore(
  score: number,
  occluded: boolean,
  rowBlocked: boolean,
  blockedFlag?: boolean
): SightlineGrade {
  if (blockedFlag) return 'blocked';
  if (occluded || rowBlocked || score < 0.28) return 'restricted';
  if (score >= 0.82) return 'premium';
  if (score >= 0.58) return 'good';
  if (score >= 0.4) return 'fair';
  return 'restricted';
}

function visibilityFromGrade(grade: SightlineGrade): SeatVisibility {
  switch (grade) {
    case 'blocked':
      return { blocked: true, restrictedView: false, premiumView: false };
    case 'restricted':
      return { blocked: false, restrictedView: true, premiumView: false };
    case 'premium':
      return { blocked: false, restrictedView: false, premiumView: true };
    default:
      return { blocked: false, restrictedView: false, premiumView: false };
  }
}

function segmentHitsAabb(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - minX) &&
    clip(dx, maxX - ax) &&
    clip(-dy, ay - minY) &&
    clip(dy, maxY - ay) &&
    t0 < t1
  );
}

/**
 * 3D-ish obstacle test: plan segment hits obstacle AABB AND the LOS height
 * at the obstacle is below obstacle top (height in map units).
 */
function obstacleBlocks3d(
  seat: ResolvedSeat,
  stageX: number,
  stageY: number,
  stageZ: number,
  eyeZ: number,
  obstacles: ResolvedVenueScene['obstacles']
): boolean {
  for (const obs of obstacles) {
    if (!obs.points?.length) continue;
    const xs = obs.points.map((p) => p[0]);
    const ys = obs.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 2;
    const hit = segmentHitsAabb(
      seat.x,
      seat.y,
      stageX,
      stageY,
      minX + pad,
      minY + pad,
      maxX - pad,
      maxY - pad
    );
    if (!hit) continue;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const seatDist = Math.hypot(seat.x - stageX, seat.y - stageY) || 1;
    const t = 1 - Math.hypot(cx - stageX, cy - stageY) / seatDist;
    const tClamped = Math.max(0.05, Math.min(0.95, t));
    const losZ = eyeZ + (stageZ - eyeZ) * tClamped;
    const top = obs.height ?? 160;
    // Obstacle rests on floor (z≈0); blocks if its top rises into the LOS
    if (top > losZ - 2) return true;
  }
  return false;
}

type FrontHit = { cValue: number; blocked: boolean };

type SightlineSolveOpts = {
  eyeHeight: number;
  headHeight: number;
  minC: number;
  corridorHalfWidth: number;
};

/**
 * Classic theater C-value vs nearest seat in front along the stage corridor.
 * C = eyeZ - headZ_front_at_LOS  (positive = clearance over front head).
 */
function rowOcclusion(
  seat: ResolvedSeat,
  seats: ResolvedSeat[],
  stageX: number,
  stageY: number,
  stageZ: number,
  opts: SightlineSolveOpts
): FrontHit | null {
  const eyeZ = (seat.elevation ?? seat.position.y ?? 0) + opts.eyeHeight;
  const toStageX = stageX - seat.x;
  const toStageY = stageY - seat.y;
  const seatDist = Math.hypot(toStageX, toStageY);
  if (seatDist < 1) return null;

  const dirX = toStageX / seatDist;
  const dirY = toStageY / seatDist;
  // Perpendicular for corridor
  const perpX = -dirY;
  const perpY = dirX;

  let best: FrontHit | null = null;
  let bestDist = Infinity;

  for (const other of seats) {
    if (other.id === seat.id) continue;
    // Prefer same section / level; still allow nearby cross-section blockers
    const sameBand =
      other.sectionId === seat.sectionId || (other.levelId && other.levelId === seat.levelId);
    if (!sameBand && Math.hypot(other.x - seat.x, other.y - seat.y) > opts.corridorHalfWidth * 4) {
      continue;
    }

    const ox = other.x - seat.x;
    const oy = other.y - seat.y;
    const along = ox * dirX + oy * dirY;
    if (along < 4 || along >= seatDist - 2) continue; // must be between seat and stage
    const lateral = Math.abs(ox * perpX + oy * perpY);
    if (lateral > opts.corridorHalfWidth) continue;

    const otherDist = Math.hypot(other.x - stageX, other.y - stageY);
    if (otherDist >= seatDist) continue;

    const t = along / seatDist;
    const losZ = eyeZ + (stageZ - eyeZ) * t;
    const headZ = (other.elevation ?? other.position.y ?? 0) + opts.headHeight;
    const cValue = losZ - headZ;
    const blocked = cValue < opts.minC;

    if (along < bestDist) {
      bestDist = along;
      best = { cValue, blocked };
    }
  }

  return best;
}

type FocusTarget = {
  id: string;
  x: number;
  y: number;
  z: number;
  label?: string;
  levelId?: string;
};

function resolveFocuses(scene: ResolvedVenueScene): FocusTarget[] {
  const authored = scene.map.venue?.focusPoints ?? [];
  if (authored.length) {
    return authored.map((f, i) => ({
      id: f.id || `focus-${i}`,
      label: f.label,
      levelId: f.levelId,
      x: f.x,
      y: f.y,
      z: f.z ?? scene.stage?.elevation ?? 40,
    }));
  }
  const stage = scene.stage;
  const x = stage ? stage.x + stage.width / 2 : scene.bounds.minX + scene.bounds.width / 2;
  const y = stage ? stage.y + 10 : scene.bounds.minY;
  const z = stage?.elevation ?? 40;
  return [{ id: 'stage-center', label: 'Escenario', x, y, z }];
}

function focusesForSeat(seat: ResolvedSeat, focuses: FocusTarget[]): FocusTarget[] {
  if (!seat.levelId) return focuses;
  const same = focuses.filter((f) => !f.levelId || f.levelId === seat.levelId);
  return same.length ? same : focuses;
}

function scoreSeatVsFocus(
  seat: ResolvedSeat,
  seats: ResolvedSeat[],
  focus: FocusTarget,
  maxDist: number,
  opts: SightlineSolveOpts,
  obstacles: ResolvedVenueScene['obstacles']
): Omit<SightlineScore, 'seatId' | 'visibility' | 'grade'> {
  const distance = Math.hypot(seat.x - focus.x, seat.y - focus.y);
  const distScore = 1 - distance / maxDist;

  const yaw = degToRad(seat.rotation3d?.y ?? seat.rotation ?? 0);
  const faceX = Math.sin(yaw);
  const faceY = -Math.cos(yaw);
  const toX = focus.x - seat.x;
  const toY = focus.y - seat.y;
  const toLen = Math.hypot(toX, toY) || 1;
  const facingDot = (faceX * toX + faceY * toY) / toLen;
  const facingScore = clamp01((facingDot + 1) / 2);

  const elev = seat.elevation ?? seat.position.y ?? 0;
  const elevationBonus = clamp01(elev / 120) * 0.15;
  const eyeZ = elev + opts.eyeHeight;

  const occluded = obstacleBlocks3d(seat, focus.x, focus.y, focus.z, eyeZ, obstacles);
  const front = rowOcclusion(seat, seats, focus.x, focus.y, focus.z, opts);
  const rowBlocked = Boolean(front?.blocked);
  const cPenalty = front ? (front.blocked ? -0.4 : clamp01(front.cValue / 20) * 0.08) : 0;

  let score = clamp01(
    distScore * 0.4 + facingScore * 0.35 + elevationBonus + (occluded ? -0.4 : 0) + cPenalty
  );
  if (seat.visibility?.blocked) score = 0;

  return {
    score: Math.round(score * 1000) / 1000,
    distance: Math.round(distance * 10) / 10,
    facingDot: Math.round(facingDot * 1000) / 1000,
    elevationBonus: Math.round(elevationBonus * 1000) / 1000,
    occluded,
    rowBlocked,
    cValue: front ? Math.round(front.cValue * 10) / 10 : undefined,
    focusId: focus.id,
  };
}

/**
 * Sightline solver v2+:
 * - multi-focus: best score across venue.focusPoints (or stage center)
 * - distance, facing, elevation, obstacle height, row C-value
 */
export function calculateSightlines(
  scene: ResolvedVenueScene,
  options?: SightlineOptions
): SightlineResult {
  const opts = {
    eyeHeight: options?.eyeHeight ?? 12,
    headHeight: options?.headHeight ?? 14,
    minC: options?.minC ?? 4,
    corridorHalfWidth: options?.corridorHalfWidth ?? 18,
  };
  const levelId = options?.levelId;
  const seats = levelId
    ? scene.seats.filter((s) => !s.levelId || s.levelId === levelId)
    : scene.seats;

  const focuses = resolveFocuses(scene);
  const primary = focuses[0];
  const stageTarget = { x: primary.x, y: primary.z, z: primary.y };

  const maxDist = Math.max(
    1,
    ...seats.flatMap((s) => focuses.map((f) => Math.hypot(s.x - f.x, s.y - f.y)))
  );

  const scores: SightlineScore[] = seats.map((seat) => {
    let best: Omit<SightlineScore, 'seatId' | 'visibility' | 'grade'> | null = null;
    const pool = focusesForSeat(seat, focuses);
    for (const focus of pool) {
      const candidate = scoreSeatVsFocus(seat, seats, focus, maxDist, opts, scene.obstacles);
      if (!best || candidate.score > best.score) best = candidate;
    }
    const hit = best!;
    const grade = gradeFromScore(hit.score, hit.occluded, hit.rowBlocked, seat.visibility?.blocked);
    const visibility = seat.visibility?.blocked
      ? { blocked: true as const, restrictedView: false, premiumView: false }
      : visibilityFromGrade(grade);

    return {
      seatId: seat.id,
      ...hit,
      grade,
      visibility,
    };
  });

  const summary: Record<SightlineGrade, number> = {
    premium: 0,
    good: 0,
    fair: 0,
    restricted: 0,
    blocked: 0,
  };
  for (const s of scores) summary[s.grade] += 1;

  return { scores, stageTarget, focuses, summary };
}

/** Merge sightline visibility into a resolved scene's seats (non-destructive copy). */
export function applySightlinesToScene(
  scene: ResolvedVenueScene,
  options?: SightlineOptions
): {
  scene: ResolvedVenueScene;
  result: SightlineResult;
} {
  const result = calculateSightlines(scene, options);
  const byId = new Map(result.scores.map((s) => [s.seatId, s]));
  const seats = scene.seats.map((seat) => {
    const hit = byId.get(seat.id);
    if (!hit) return seat;
    return {
      ...seat,
      visibility: seat.visibility?.blocked ? seat.visibility : hit.visibility,
      metadata: {
        ...(seat.metadata ?? {}),
        sightline: {
          score: hit.score,
          grade: hit.grade,
          occluded: hit.occluded,
          rowBlocked: hit.rowBlocked,
          cValue: hit.cValue,
          focusId: hit.focusId,
        },
      },
    };
  });
  return { scene: { ...scene, seats }, result };
}
