import type {
  SeatMapAisle,
  SeatMapCadLocks,
  SeatMapData,
  SeatMapExit,
  SeatMapFocusPoint,
  SeatMapFurniture,
  SeatMapLevel,
  SeatMapObstacle,
  SeatMapSection,
  SeatMapStage,
  SeatMapStair,
} from '@boletera/shared';
import { computeMapBounds } from '../map-utils';
import { resolveLevelToken } from './cad-level-tags';
import { migrateToV3 } from './migrate';

/** Roles usable in CAD review UI (skip = discard on commit). */
export type CadEntityRole =
  | 'section'
  | 'aisle'
  | 'obstacle'
  | 'stage'
  | 'stairs'
  | 'exit'
  | 'furniture'
  | 'focus'
  | 'skip';

export type CadReviewPrimitive = {
  id: string;
  /** Heuristic role from parser */
  suggestedRole: Exclude<CadEntityRole, 'skip'>;
  /** Editable role (may be skip) */
  role: CadEntityRole;
  name: string;
  /** Layer / class / data-role hint */
  source?: string;
  points: [number, number][];
  color?: string;
  width?: number;
  /** Focus elevation (map Z), not scaled with CAD fit */
  z?: number;
  pointCount: number;
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
};

export type CadImportStats = {
  sections: number;
  aisles: number;
  obstacles: number;
  stairs: number;
  exits: number;
  furniture: number;
  focuses: number;
  stage: boolean;
  skipped: number;
  /** Skipped because venue.cadLocks blocked the role */
  lockedSkipped: number;
  entities: number;
};

export type CadApplyOptions = {
  mode?: 'merge' | 'replace-meta';
  /** Prefix for empty section names */
  sectionLabel?: string;
  /** Venue levels catalog from CAD meta (SVG data-levels / DXF BOLETERA_LEVELS) */
  levels?: SeatMapLevel[];
  /** Honor CAD locks from the target map (locked layers are not imported / not cleared) */
  cadLocks?: SeatMapCadLocks | null;
};

export type CadApplyPrimitive = {
  id: string;
  role: CadEntityRole;
  name: string;
  points: [number, number][];
  color?: string;
  width?: number;
  z?: number;
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
};

/** Map CAD review roles → SeatMapCadLocks keys. */
export function cadLockKeyForRole(role: CadEntityRole): keyof SeatMapCadLocks | null {
  switch (role) {
    case 'aisle':
      return 'aisles';
    case 'obstacle':
      return 'obstacles';
    case 'stairs':
      return 'stairs';
    case 'exit':
      return 'exits';
    case 'stage':
      return 'stage';
    case 'furniture':
      return 'furniture';
    case 'focus':
      return 'focusPoints';
    default:
      return null;
  }
}

export function isCadRoleLocked(role: CadEntityRole, locks?: SeatMapCadLocks | null): boolean {
  const key = cadLockKeyForRole(role);
  return Boolean(key && locks?.[key]);
}

/** Force-skip review rows whose role (or suggested role) is CAD-locked. */
export function enforceCadLocksOnReview(
  rows: CadReviewPrimitive[],
  locks?: SeatMapCadLocks | null
): { rows: CadReviewPrimitive[]; lockedCount: number } {
  if (!locks) return { rows, lockedCount: 0 };
  let lockedCount = 0;
  const next = rows.map((r) => {
    if (r.role === 'skip') return r;
    if (isCadRoleLocked(r.role, locks) || isCadRoleLocked(r.suggestedRole, locks)) {
      lockedCount += 1;
      return { ...r, role: 'skip' as const };
    }
    return r;
  });
  return { rows: next, lockedCount };
}

/** Human labels for active locks (Spanish UI). */
export function activeCadLockLabels(locks?: SeatMapCadLocks | null): string[] {
  if (!locks) return [];
  const labels: Array<[keyof SeatMapCadLocks, string]> = [
    ['aisles', 'Pasillos'],
    ['obstacles', 'Obstáculos'],
    ['stairs', 'Escaleras'],
    ['exits', 'Salidas'],
    ['stage', 'Escenario'],
    ['furniture', 'Mobiliario'],
    ['focusPoints', 'Focos'],
  ];
  return labels.filter(([k]) => locks[k]).map(([, label]) => label);
}

function mergeLockedLayer<T>(
  mode: 'merge' | 'replace-meta',
  locked: boolean,
  base: T[] | undefined,
  incoming: T[]
): T[] {
  if (locked) return base ?? [];
  if (mode === 'replace-meta') return incoming;
  return [...(base ?? []), ...incoming];
}

const SECTION_COLORS = [
  '#5b9fd4',
  '#c45c6a',
  '#c4a35a',
  '#5a9e78',
  '#7a8fd4',
  '#b87a9a',
  '#8b9aab',
];

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'zone'
  );
}

function stairKindFromName(hay: string): SeatMapStair['kind'] {
  if (/vomitor/i.test(hay)) return 'vomitoria';
  if (/ramp/i.test(hay)) return 'ramp';
  return 'stairs';
}

function furnitureTypeFromName(hay: string): SeatMapFurniture['type'] {
  if (/speaker|altavoz|pa\b/i.test(hay)) return 'speaker';
  if (/door|puerta/i.test(hay)) return 'door';
  return 'led';
}

function exitPoints(points: [number, number][]): [number, number][] {
  if (!points.length) return [];
  if (points.length <= 2) return points;
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [[cx, cy]];
}

export function toCadReviewPrimitive(p: {
  id: string;
  role: Exclude<CadEntityRole, 'skip'>;
  name: string;
  points: [number, number][];
  color?: string;
  width?: number;
  z?: number;
  source?: string;
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
}): CadReviewPrimitive {
  return {
    id: p.id,
    suggestedRole: p.role,
    role: p.role,
    name: p.name,
    source: p.source,
    points: p.points,
    color: p.color,
    width: p.width,
    pointCount: p.points.length,
    ...(p.z != null && Number.isFinite(p.z) ? { z: p.z } : {}),
    ...(p.levelId ? { levelId: p.levelId } : {}),
    ...(p.fromLevelId ? { fromLevelId: p.fromLevelId } : {}),
    ...(p.toLevelId ? { toLevelId: p.toLevelId } : {}),
  };
}

function mergeLevels(
  base: SeatMapLevel[] | undefined,
  imported: SeatMapLevel[] | undefined,
  mode: 'merge' | 'replace-meta'
): SeatMapLevel[] | undefined {
  if (!imported?.length) return base;
  if (mode === 'replace-meta' || !base?.length) return imported;
  const byId = new Map(base.map((l) => [l.id, l]));
  for (const l of imported) {
    if (!byId.has(l.id)) byId.set(l.id, l);
  }
  return [...byId.values()];
}

/**
 * Apply reviewed CAD primitives onto a SeatMapData document.
 * Primitives with role `skip` are ignored.
 * When `opts.cadLocks` is set, locked roles are skipped and existing layers are preserved
 * (even in replace-meta mode).
 */
export function applyCadPrimitivesToSeatMap(
  primitives: CadApplyPrimitive[],
  base?: SeatMapData | null,
  opts?: CadApplyOptions
): { map: SeatMapData; stats: CadImportStats } {
  const mode = opts?.mode ?? 'merge';
  const sectionLabel = opts?.sectionLabel ?? 'Zona';
  const locks = opts?.cadLocks ?? null;
  const baseMap = migrateToV3(base ?? { sections: [], version: 3 });
  const levelCatalog = mergeLevels(baseMap.venue?.levels, opts?.levels, mode) ?? [];

  const resolve = (token?: string) => resolveLevelToken(token, levelCatalog);

  const aisleLocked = isCadRoleLocked('aisle', locks);
  const obstacleLocked = isCadRoleLocked('obstacle', locks);
  const stairLocked = isCadRoleLocked('stairs', locks);
  const exitLocked = isCadRoleLocked('exit', locks);
  const furnitureLocked = isCadRoleLocked('furniture', locks);
  const stageLocked = isCadRoleLocked('stage', locks);
  const focusLocked = isCadRoleLocked('focus', locks);

  const aisles: SeatMapAisle[] = [];
  const obstacles: SeatMapObstacle[] = [];
  const stairs: SeatMapStair[] = [];
  const exits: SeatMapExit[] = [];
  const furnitureItems: SeatMapFurniture[] = [];
  const focusItems: SeatMapFocusPoint[] = [];
  let stage: SeatMapStage | undefined = stageLocked
    ? baseMap.venue?.stage
    : mode === 'replace-meta'
      ? undefined
      : baseMap.venue?.stage;
  const newSections: SeatMapSection[] = [];
  let secIdx = 0;
  let skipped = 0;
  let lockedSkipped = 0;

  for (const p of primitives) {
    if (p.role === 'skip') {
      skipped += 1;
      continue;
    }
    if (isCadRoleLocked(p.role, locks)) {
      skipped += 1;
      lockedSkipped += 1;
      continue;
    }
    if (p.role === 'aisle') {
      if (p.points.length < 2) {
        skipped += 1;
        continue;
      }
      const levelId = resolve(p.levelId);
      aisles.push({
        id: p.id,
        points: p.points,
        ...(p.width != null ? { width: p.width } : {}),
        ...(levelId ? { levelId } : {}),
      });
      continue;
    }
    if (p.role === 'obstacle') {
      if (p.points.length < 3) {
        skipped += 1;
        continue;
      }
      const levelId = resolve(p.levelId);
      obstacles.push({
        id: p.id,
        type: 'barrier',
        points: p.points,
        height: 160,
        ...(levelId ? { levelId } : {}),
      });
      continue;
    }
    if (p.role === 'furniture') {
      if (!p.points.length) {
        skipped += 1;
        continue;
      }
      const [x, y] = p.points[0];
      const levelId = resolve(p.levelId);
      furnitureItems.push({
        id: p.id,
        type: furnitureTypeFromName(p.name + p.id),
        x,
        y,
        rotation: 0,
        ...(levelId ? { levelId } : {}),
      });
      continue;
    }
    if (p.role === 'focus') {
      if (!p.points.length) {
        skipped += 1;
        continue;
      }
      const [x, y] = p.points[0];
      const label = p.name?.trim() || undefined;
      const levelId = resolve(p.levelId);
      focusItems.push({
        id: p.id,
        x,
        y,
        ...(label ? { label } : {}),
        ...(p.z != null && Number.isFinite(p.z) ? { z: p.z } : {}),
        ...(levelId ? { levelId } : {}),
      });
      continue;
    }
    if (p.role === 'stairs') {
      if (p.points.length < 2) {
        skipped += 1;
        continue;
      }
      const fromLevelId = resolve(p.fromLevelId);
      const toLevelId = resolve(p.toLevelId);
      stairs.push({
        id: p.id,
        kind: stairKindFromName(p.name + p.id),
        points: p.points,
        ...(p.width != null ? { width: p.width } : {}),
        ...(fromLevelId ? { fromLevelId } : {}),
        ...(toLevelId ? { toLevelId } : {}),
      });
      continue;
    }
    if (p.role === 'exit') {
      const points = exitPoints(p.points);
      if (!points.length) {
        skipped += 1;
        continue;
      }
      const levelId = resolve(p.levelId);
      exits.push({
        id: p.id,
        points,
        label: p.name || undefined,
        ...(p.width != null ? { width: p.width } : {}),
        ...(levelId ? { levelId } : {}),
      });
      continue;
    }
    if (p.role === 'stage') {
      if (!p.points.length) {
        skipped += 1;
        continue;
      }
      const xs = p.points.map((pt) => pt[0]);
      const ys = p.points.map((pt) => pt[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      stage = {
        x: minX,
        y: minY,
        width: Math.max(maxX - minX, 40),
        elevation: stage?.elevation ?? baseMap.venue?.stage?.elevation ?? 40,
      };
      continue;
    }
    // section
    if (p.points.length < 3) {
      skipped += 1;
      continue;
    }
    const levelId = resolve(p.levelId);
    newSections.push({
      id: p.id,
      name: p.name || `${sectionLabel} ${secIdx + 1}`,
      slug: slugify(p.name || `cad-${secIdx}`),
      color: p.color || SECTION_COLORS[secIdx % SECTION_COLORS.length],
      seats: [],
      shape: { points: p.points },
      ...(levelId ? { levelId } : {}),
    });
    secIdx += 1;
  }

  const sections =
    mode === 'replace-meta'
      ? newSections
      : [
          ...baseMap.sections,
          ...newSections.filter((ns) => !baseMap.sections.some((s) => s.slug === ns.slug)),
        ];

  const levels = mergeLevels(baseMap.venue?.levels, opts?.levels, mode);

  const map: SeatMapData = {
    ...baseMap,
    version: 3,
    sections,
    venue: {
      ...(baseMap.venue ?? {}),
      stage,
      aisles: mergeLockedLayer(mode, aisleLocked, baseMap.venue?.aisles, aisles),
      obstacles: mergeLockedLayer(mode, obstacleLocked, baseMap.venue?.obstacles, obstacles),
      stairs: mergeLockedLayer(mode, stairLocked, baseMap.venue?.stairs, stairs),
      exits: mergeLockedLayer(mode, exitLocked, baseMap.venue?.exits, exits),
      furniture: mergeLockedLayer(mode, furnitureLocked, baseMap.venue?.furniture, furnitureItems),
      focusPoints: (() => {
        const merged = mergeLockedLayer(mode, focusLocked, baseMap.venue?.focusPoints, focusItems);
        return merged.length ? merged : undefined;
      })(),
      units: baseMap.venue?.units ?? 'map',
      scale: baseMap.venue?.scale ?? 40,
      snapPitch: baseMap.venue?.snapPitch ?? 26,
      levels,
    },
  };

  const bounds = computeMapBounds(map);
  map.viewport = {
    width: bounds.width,
    height: bounds.height,
    minX: bounds.minX,
    minY: bounds.minY,
  };

  return {
    map,
    stats: {
      sections: newSections.length,
      aisles: aisles.length,
      obstacles: obstacles.length,
      stairs: stairs.length,
      exits: exits.length,
      furniture: furnitureItems.length,
      focuses: focusItems.length,
      stage: Boolean(stage),
      skipped,
      lockedSkipped,
      entities: primitives.length,
    },
  };
}

/** Commit reviewed rows (after user reclassified / skipped). */
export function commitCadImportReview(
  reviewed: CadReviewPrimitive[],
  base?: SeatMapData | null,
  opts?: CadApplyOptions
): { map: SeatMapData; stats: CadImportStats } {
  return applyCadPrimitivesToSeatMap(
    reviewed.map((r) => ({
      id: r.id,
      role: r.role,
      name: r.name,
      points: r.points,
      color: r.color,
      width: r.width,
      z: r.z,
      levelId: r.levelId,
      fromLevelId: r.fromLevelId,
      toLevelId: r.toLevelId,
    })),
    base,
    opts
  );
}

export const CAD_ENTITY_ROLES: CadEntityRole[] = [
  'section',
  'aisle',
  'obstacle',
  'stairs',
  'exit',
  'furniture',
  'focus',
  'stage',
  'skip',
];

export const CAD_ROLE_LABELS: Record<CadEntityRole, string> = {
  section: 'Sección',
  aisle: 'Pasillo',
  obstacle: 'Obstáculo',
  stairs: 'Escalera',
  exit: 'Salida',
  furniture: 'Mobiliario',
  focus: 'Foco vista',
  stage: 'Escenario',
  skip: 'Omitir',
};
