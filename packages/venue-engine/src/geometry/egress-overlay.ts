import type { SeatMapData } from '@boletera/shared';
import { analyzeCirculation, type CirculationAnalysis, type CirculationGraph } from './circulation';
import { resolveGeometry } from './resolve';
import {
  getPlanProjectionFrame,
  mapPointToWorld3D,
  type PlanProjectionFrame,
  type ProjectTo3DOptions,
} from './project';
import type { ResolvedVenueScene } from './types';

export type EgressPathOverlay = {
  sectionId: string;
  sectionName?: string;
  /** Section authored level (when set) */
  levelId?: string;
  points: [number, number][];
  /** Parallel to points — circulation node level for 3D elev */
  pointLevels?: (string | undefined)[];
  pathLength: number | null;
  clearanceMinutes: number | null;
  reachable: boolean;
};

export type EgressBottleneckOverlay = {
  edgeId: string;
  kind: string;
  points: [number, number][];
  pointLevels?: (string | undefined)[];
  utilization: number;
  seatLoad: number;
};

export type EgressOverlayScene = {
  hasNetwork: boolean;
  seedMode: CirculationAnalysis['seedMode'];
  exitCount: number;
  paths: EgressPathOverlay[];
  bottlenecks: EgressBottleneckOverlay[];
  clearanceMinutes: number | null;
};

export type EgressPathOverlay3D = {
  sectionId: string;
  sectionName?: string;
  levelId?: string;
  points: [number, number, number][];
  pathLength: number | null;
  clearanceMinutes: number | null;
  reachable: boolean;
};

export type EgressBottleneckOverlay3D = {
  edgeId: string;
  kind: string;
  points: [number, number, number][];
  utilization: number;
  seatLoad: number;
};

export type EgressOverlayScene3D = {
  hasNetwork: boolean;
  seedMode: CirculationAnalysis['seedMode'];
  exitCount: number;
  paths: EgressPathOverlay3D[];
  bottlenecks: EgressBottleneckOverlay3D[];
  clearanceMinutes: number | null;
};

export type EgressOverlayOptions = {
  bottleneckLimit?: number;
  analysis?: CirculationAnalysis;
  /**
   * When set, keep paths whose section is on this level (untagged sections stay visible).
   * Bottlenecks kept if either endpoint matches or is untagged.
   */
  levelId?: string;
};

function isResolvedScene(input: SeatMapData | ResolvedVenueScene): input is ResolvedVenueScene {
  return Array.isArray((input as ResolvedVenueScene).seats) && 'map' in input;
}

function nodeMap(graph: CirculationGraph) {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function matchesLevelFilter(
  entityLevelId: string | undefined,
  filterLevelId: string | undefined
): boolean {
  if (!filterLevelId) return true;
  if (!entityLevelId) return true;
  return entityLevelId === filterLevelId;
}

function endpointTouchesLevel(
  aLevel: string | undefined,
  bLevel: string | undefined,
  filterLevelId: string | undefined
): boolean {
  if (!filterLevelId) return true;
  return matchesLevelFilter(aLevel, filterLevelId) || matchesLevelFilter(bLevel, filterLevelId);
}

function levelElevY(
  scene: ResolvedVenueScene,
  frame: PlanProjectionFrame,
  levelId: string | undefined,
  base = 0.1
): number {
  if (!levelId) return base;
  const levels = scene.levels?.length ? scene.levels : (scene.map.venue?.levels ?? []);
  const lv = levels.find((l) => l.id === levelId);
  if (!lv || !Number.isFinite(lv.elevation)) return base;
  return lv.elevation * frame.elevScale + base;
}

/** Resolve polyline points for a section's shortest egress path. */
export function pathPointsForSection(
  analysis: CirculationAnalysis,
  sectionId: string
): {
  points: [number, number][];
  pointLevels: (string | undefined)[];
  pathLength: number | null;
  clearanceMinutes: number | null;
} | null {
  const secEg = analysis.egress.sections.find((s) => s.sectionId === sectionId);
  if (!secEg?.pathNodeIds?.length) return null;
  const nodes = nodeMap(analysis.graph);
  const points: [number, number][] = [];
  const pointLevels: (string | undefined)[] = [];
  for (const nid of secEg.pathNodeIds) {
    const n = nodes.get(nid);
    if (n) {
      points.push([n.x, n.y]);
      pointLevels.push(n.levelId);
    }
  }
  if (points.length < 2) return null;
  return {
    points,
    pointLevels,
    pathLength: secEg.pathLength,
    clearanceMinutes: secEg.clearanceMinutes,
  };
}

function bottleneckPolylines(
  analysis: CirculationAnalysis,
  limit = 3,
  filterLevelId?: string
): EgressBottleneckOverlay[] {
  const nodes = nodeMap(analysis.graph);
  const edgeById = new Map(analysis.graph.edges.map((e) => [e.id, e]));
  const out: EgressBottleneckOverlay[] = [];
  for (const b of analysis.egress.bottlenecks.slice(0, limit)) {
    const edge = edgeById.get(b.edgeId);
    if (!edge) continue;
    const a = nodes.get(edge.from);
    const c = nodes.get(edge.to);
    if (!a || !c) continue;
    if (!endpointTouchesLevel(a.levelId, c.levelId, filterLevelId)) continue;
    out.push({
      edgeId: b.edgeId,
      kind: b.kind,
      points: [
        [a.x, a.y],
        [c.x, c.y],
      ],
      pointLevels: [a.levelId, c.levelId],
      utilization: b.utilization,
      seatLoad: b.seatLoad,
    });
  }
  return out;
}

/**
 * Build 2D overlay polylines for section egress routes (+ top bottlenecks).
 */
export function buildEgressPathOverlays(
  input: SeatMapData | ResolvedVenueScene,
  opts?: EgressOverlayOptions
): EgressOverlayScene {
  const scene = isResolvedScene(input) ? input : resolveGeometry(input);
  const analysis = opts?.analysis ?? analyzeCirculation(scene);
  const filterLevelId = opts?.levelId;
  const sectionLevel = new Map(scene.sections.map((s) => [s.id, s.levelId]));

  const paths: EgressPathOverlay[] = analysis.egress.sections
    .filter((sec) => matchesLevelFilter(sectionLevel.get(sec.sectionId), filterLevelId))
    .map((sec) => {
      const resolved = pathPointsForSection(analysis, sec.sectionId);
      return {
        sectionId: sec.sectionId,
        sectionName: sec.sectionName,
        levelId: sectionLevel.get(sec.sectionId),
        points: resolved?.points ?? [],
        pointLevels: resolved?.pointLevels,
        pathLength: sec.pathLength,
        clearanceMinutes: sec.clearanceMinutes,
        reachable: Boolean(resolved && sec.pathLength != null),
      };
    });

  return {
    hasNetwork: analysis.hasNetwork,
    seedMode: analysis.seedMode,
    exitCount: analysis.exitCount,
    paths: paths.filter((p) => p.points.length >= 2),
    bottlenecks: bottleneckPolylines(analysis, opts?.bottleneckLimit ?? 3, filterLevelId),
    clearanceMinutes: analysis.egress.clearanceMinutes,
  };
}

/**
 * Same egress overlays as 2D, projected with the seat plan→world frame.
 * Path height uses authored level elevation when available.
 */
export function projectEgressOverlaysTo3D(
  input: SeatMapData | ResolvedVenueScene,
  opts?: ProjectTo3DOptions & EgressOverlayOptions
): EgressOverlayScene3D {
  const scene = isResolvedScene(input) ? input : resolveGeometry(input);
  const overlay = buildEgressPathOverlays(scene, opts);
  const frame = getPlanProjectionFrame(scene, opts);

  const empty: EgressOverlayScene3D = {
    hasNetwork: overlay.hasNetwork,
    seedMode: overlay.seedMode,
    exitCount: overlay.exitCount,
    paths: [],
    bottlenecks: [],
    clearanceMinutes: overlay.clearanceMinutes,
  };
  if (!frame) return empty;

  const toWorld = (x: number, y: number, levelId: string | undefined, base: number) =>
    mapPointToWorld3D(frame, x, y, levelElevY(scene, frame, levelId, base));

  return {
    hasNetwork: overlay.hasNetwork,
    seedMode: overlay.seedMode,
    exitCount: overlay.exitCount,
    clearanceMinutes: overlay.clearanceMinutes,
    paths: overlay.paths.map((p) => ({
      sectionId: p.sectionId,
      sectionName: p.sectionName,
      levelId: p.levelId,
      pathLength: p.pathLength,
      clearanceMinutes: p.clearanceMinutes,
      reachable: p.reachable,
      points: p.points.map(([x, y], i) => toWorld(x, y, p.pointLevels?.[i] ?? p.levelId, 0.1)),
    })),
    bottlenecks: overlay.bottlenecks.map((b) => ({
      edgeId: b.edgeId,
      kind: b.kind,
      utilization: b.utilization,
      seatLoad: b.seatLoad,
      points: b.points.map(([x, y], i) => toWorld(x, y, b.pointLevels?.[i], 0.12)),
    })),
  };
}
