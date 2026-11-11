import type { ResolvedVenueScene } from './types';

export type CirculationNodeKind = 'stage' | 'aisle' | 'stair' | 'section' | 'exit';

export type CirculationNode = {
  id: string;
  kind: CirculationNodeKind;
  x: number;
  y: number;
  /** Optional level association */
  levelId?: string;
  label?: string;
  /** Section id when kind === 'section' */
  sectionId?: string;
};

export type CirculationEdge = {
  id: string;
  from: string;
  to: string;
  kind: 'aisle' | 'stair' | 'link' | 'access' | 'exit';
  length: number;
  /** Clear width in map units (from aisle/stair); links inherit min of endpoints when known */
  width?: number;
  /** Source aisle/stair id when applicable */
  sourceId?: string;
};

export type CirculationGraph = {
  nodes: CirculationNode[];
  edges: CirculationEdge[];
};

export type SectionEgress = {
  sectionId: string;
  sectionName?: string;
  seatCount: number;
  /** Shortest path length to stage (map units); null if unreachable */
  pathLength: number | null;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  /** Walk time along path (minutes) */
  walkMinutes: number | null;
  /** Queue time at worst path bottleneck (minutes) */
  queueMinutes: number | null;
  /** Estimated section clearance = walk + queue */
  clearanceMinutes: number | null;
};

export type EgressBottleneck = {
  edgeId: string;
  kind: CirculationEdge['kind'];
  length: number;
  width: number;
  /** Concurrent seat capacity proxy from clear width */
  capacity: number;
  /** Distinct sections whose shortest path uses this edge */
  sectionCount: number;
  /** Seats whose section path uses this edge */
  seatLoad: number;
  /** seatLoad / capacity */
  utilization: number;
  /** Legacy: seatLoad / max(length, 1) */
  loadScore: number;
  overCapacity: boolean;
  /** People/min through this edge from clear width */
  flowPerMinute: number;
  /** Minutes to clear seatLoad at flowPerMinute */
  clearanceMinutes: number;
};

export type EgressMetrics = {
  sections: SectionEgress[];
  maxPathLength: number | null;
  avgPathLength: number | null;
  totalSeatsWithPath: number;
  totalSeatsWithoutPath: number;
  /** Top edges by utilization / seat load (descending) */
  bottlenecks: EgressBottleneck[];
  /** Venue-wide estimated clearance (max of section clearances and bottleneck queues) */
  clearanceMinutes: number | null;
  /** Longest walk among reachable sections */
  maxWalkMinutes: number | null;
};

export type CirculationAnalysis = {
  graph: CirculationGraph;
  /**
   * Node ids reachable from egress seeds (exits preferred; stage/network fallback).
   * Field name kept for API compatibility.
   */
  reachableFromStage: string[];
  /** Section ids with no path to an egress seed via aisles/stairs/exits */
  unreachableSections: string[];
  /** True when there is at least one aisle, stair, or exit to form a network */
  hasNetwork: boolean;
  /** How shortest paths were seeded */
  seedMode: 'exits' | 'stage' | 'network';
  /** Count of exit nodes used (authored + door furniture) */
  exitCount: number;
  egress: EgressMetrics;
};

export type CirculationOptions = {
  /** Max distance to snap aisle/stair endpoints together. Default 36 */
  joinRadius?: number;
  /** Max distance from section centroid to nearest network node. Default 80 */
  accessRadius?: number;
  /** Path length (map units) above which validate warns. Default 900 */
  longPathThreshold?: number;
  /** Bottleneck seatLoad above which validate warns. Default 120 */
  bottleneckSeatThreshold?: number;
  /** Default aisle clear width (map units). Default 24 */
  defaultAisleWidth?: number;
  /** Default stair clear width (map units). Default 28 */
  defaultStairWidth?: number;
  /** Seats of concurrent capacity per map-unit of clear width. Default 4 */
  seatsPerWidthUnit?: number;
  /** Map units per meter (venue.scale). Used for flow/walk conversion */
  mapUnitsPerMeter?: number;
  /** Walking speed m/s. Default 1.2 */
  walkSpeedMps?: number;
  /** Persons/min/meter clear width on level aisles. Default 66 */
  flowPerMeterLevel?: number;
  /** Persons/min/meter clear width on stairs. Default 40 */
  flowPerMeterStair?: number;
  /** Clearance minutes above which validate warns. Default 8 */
  slowClearanceMinutes?: number;
};

/** Default clear widths and capacity factor (map units). */
export const EGRESS_DEFAULTS = {
  aisleWidth: 24,
  stairWidth: 28,
  seatsPerWidthUnit: 4,
  minCapacity: 8,
  walkSpeedMps: 1.2,
  flowPerMeterLevel: 66,
  flowPerMeterStair: 40,
  slowClearanceMinutes: 8,
} as const;

export function edgeCapacity(width: number, seatsPerWidthUnit?: number): number {
  const factor = seatsPerWidthUnit ?? EGRESS_DEFAULTS.seatsPerWidthUnit;
  return Math.max(EGRESS_DEFAULTS.minCapacity, Math.round(width * factor));
}

/** Convert map clear width → persons/minute using flow rates. */
export function edgeFlowPerMinute(
  widthMap: number,
  kind: CirculationEdge['kind'],
  opts?: {
    mapUnitsPerMeter?: number;
    flowPerMeterLevel?: number;
    flowPerMeterStair?: number;
  }
): number {
  const scale = Math.max(opts?.mapUnitsPerMeter ?? 40, 1);
  const widthM = widthMap / scale;
  const rate =
    kind === 'stair'
      ? (opts?.flowPerMeterStair ?? EGRESS_DEFAULTS.flowPerMeterStair)
      : (opts?.flowPerMeterLevel ?? EGRESS_DEFAULTS.flowPerMeterLevel);
  return Math.max(1, widthM * rate);
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function polylineLength(points: [number, number][]) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return len;
}

/** Same-level or unknown level may join; different authored levels must not. */
function levelsCompatible(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  return a === b;
}

function nearestSectionLevel(
  scene: ResolvedVenueScene,
  x: number,
  y: number,
  maxDist: number
): string | undefined {
  let best: { id: string; d: number } | null = null;
  for (const sec of scene.sections) {
    if (!sec.levelId) continue;
    const seats = scene.seats.filter((s) => s.sectionId === sec.id);
    let cx: number;
    let cy: number;
    if (seats.length) {
      cx = seats.reduce((s, seat) => s + seat.x, 0) / seats.length;
      cy = seats.reduce((s, seat) => s + seat.y, 0) / seats.length;
    } else if (sec.shape?.points?.length) {
      const pts = sec.shape.points;
      cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    } else continue;
    const d = dist(x, y, cx, cy);
    if (d <= maxDist && (!best || d < best.d)) best = { id: sec.levelId, d };
  }
  return best?.id;
}

/**
 * Build a lightweight circulation graph from authored aisles, stairs, exits, stage, and sections.
 * Does not invent paths — only connects authored geometry + proximity joins.
 */
export function buildCirculationGraph(
  scene: ResolvedVenueScene,
  options?: CirculationOptions
): CirculationGraph {
  const joinRadius = options?.joinRadius ?? 36;
  const defaultAisleWidth = options?.defaultAisleWidth ?? EGRESS_DEFAULTS.aisleWidth;
  const defaultStairWidth = options?.defaultStairWidth ?? EGRESS_DEFAULTS.stairWidth;
  const defaultExitWidth = 32;
  const nodes: CirculationNode[] = [];
  const edges: CirculationEdge[] = [];
  const byId = new Map<string, CirculationNode>();
  const nodeWidth = new Map<string, number>();

  const addNode = (n: CirculationNode, width?: number) => {
    if (byId.has(n.id)) return byId.get(n.id)!;
    nodes.push(n);
    byId.set(n.id, n);
    if (width != null) nodeWidth.set(n.id, width);
    return n;
  };

  const addEdge = (
    from: string,
    to: string,
    kind: CirculationEdge['kind'],
    length: number,
    meta?: { width?: number; sourceId?: string }
  ) => {
    if (from === to) return;
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    const id = `${kind}:${a}->${b}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({
      id,
      from,
      to,
      kind,
      length,
      width: meta?.width,
      sourceId: meta?.sourceId,
    });
  };

  const stage = scene.stage;
  if (stage) {
    addNode({
      id: 'stage',
      kind: 'stage',
      x: stage.x + stage.width / 2,
      y: stage.y + 10,
      label: 'Escenario',
    });
  }

  scene.aisles.forEach((aisle) => {
    const pts = aisle.points;
    if (pts.length < 2) return;
    const w = aisle.width ?? defaultAisleWidth;
    const aisleLevel =
      aisle.levelId ?? nearestSectionLevel(scene, pts[0][0], pts[0][1], joinRadius * 2.5);
    const nodeIds: string[] = [];
    pts.forEach((p, pi) => {
      const id = `aisle:${aisle.id}:${pi}`;
      addNode(
        {
          id,
          kind: 'aisle',
          x: p[0],
          y: p[1],
          levelId: aisleLevel,
          label: pi === 0 || pi === pts.length - 1 ? aisle.id : undefined,
        },
        w
      );
      nodeIds.push(id);
    });
    for (let i = 1; i < nodeIds.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      addEdge(nodeIds[i - 1], nodeIds[i], 'aisle', dist(a[0], a[1], b[0], b[1]), {
        width: w,
        sourceId: aisle.id,
      });
    }
  });

  scene.stairs.forEach((stair) => {
    const pts = stair.points;
    if (pts.length < 2) return;
    const w = stair.width ?? defaultStairWidth;
    const inferR = Math.max(joinRadius * 3, 100);
    const fromLevel = stair.fromLevelId ?? nearestSectionLevel(scene, pts[0][0], pts[0][1], inferR);
    const toLevel =
      stair.toLevelId ??
      nearestSectionLevel(scene, pts[pts.length - 1][0], pts[pts.length - 1][1], inferR);
    const startId = `stair:${stair.id}:0`;
    const endId = `stair:${stair.id}:${pts.length - 1}`;
    addNode(
      {
        id: startId,
        kind: 'stair',
        x: pts[0][0],
        y: pts[0][1],
        levelId: fromLevel,
        label: stair.kind ?? 'stairs',
      },
      w
    );
    addNode(
      {
        id: endId,
        kind: 'stair',
        x: pts[pts.length - 1][0],
        y: pts[pts.length - 1][1],
        levelId: toLevel,
        label: stair.kind ?? 'stairs',
      },
      w
    );
    for (let i = 1; i < pts.length - 1; i++) {
      const midId = `stair:${stair.id}:${i}`;
      const t = i / (pts.length - 1);
      // Midpoints inherit from-level (stair run); endpoints carry to/from.
      addNode(
        {
          id: midId,
          kind: 'stair',
          x: pts[i][0],
          y: pts[i][1],
          levelId: t < 0.5 ? fromLevel : toLevel,
        },
        w
      );
      addEdge(
        `stair:${stair.id}:${i - 1}`,
        midId,
        'stair',
        dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]),
        { width: w, sourceId: stair.id }
      );
    }
    if (pts.length === 2) {
      addEdge(startId, endId, 'stair', polylineLength(pts), { width: w, sourceId: stair.id });
    } else {
      addEdge(
        `stair:${stair.id}:${pts.length - 2}`,
        endId,
        'stair',
        dist(
          pts[pts.length - 2][0],
          pts[pts.length - 2][1],
          pts[pts.length - 1][0],
          pts[pts.length - 1][1]
        ),
        { width: w, sourceId: stair.id }
      );
    }
  });

  (scene.exits ?? []).forEach((exit) => {
    const pts = exit.points;
    if (!pts.length) return;
    const w = exit.width ?? defaultExitWidth;
    if (pts.length === 1) {
      addNode(
        {
          id: `exit:${exit.id}:0`,
          kind: 'exit',
          x: pts[0][0],
          y: pts[0][1],
          levelId: exit.levelId,
          label: exit.label ?? exit.id,
        },
        w
      );
      return;
    }
    const nodeIds: string[] = [];
    pts.forEach((p, pi) => {
      const id = `exit:${exit.id}:${pi}`;
      addNode(
        {
          id,
          kind: 'exit',
          x: p[0],
          y: p[1],
          levelId: exit.levelId,
          label: pi === 0 ? (exit.label ?? exit.id) : undefined,
        },
        w
      );
      nodeIds.push(id);
    });
    for (let i = 1; i < nodeIds.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      addEdge(nodeIds[i - 1], nodeIds[i], 'exit', dist(a[0], a[1], b[0], b[1]), {
        width: w,
        sourceId: exit.id,
      });
    }
  });

  const joinable = nodes.filter((n) => n.kind !== 'section');
  for (let i = 0; i < joinable.length; i++) {
    for (let j = i + 1; j < joinable.length; j++) {
      const a = joinable[i];
      const b = joinable[j];
      // Stair edges already bridge levels; proximity must stay same-level.
      if (!levelsCompatible(a.levelId, b.levelId)) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      // Link nearby nodes (including near-coincident endpoints: exit↔aisle).
      if (d <= joinRadius) {
        const wa = nodeWidth.get(a.id);
        const wb = nodeWidth.get(b.id);
        const w = wa != null && wb != null ? Math.min(wa, wb) : (wa ?? wb ?? defaultAisleWidth);
        addEdge(a.id, b.id, 'link', Math.max(d, 0.01), { width: w });
      }
    }
  }

  return { nodes, edges };
}

type WeightedAdj = Map<string, Array<{ to: string; length: number; edgeId: string }>>;

function buildWeightedAdj(edges: CirculationEdge[]): WeightedAdj {
  const adj: WeightedAdj = new Map();
  for (const e of edges) {
    const a = adj.get(e.from) ?? [];
    a.push({ to: e.to, length: e.length, edgeId: e.id });
    adj.set(e.from, a);
    const b = adj.get(e.to) ?? [];
    b.push({ to: e.from, length: e.length, edgeId: e.id });
    adj.set(e.to, b);
  }
  return adj;
}

/** Dijkstra from seeds; returns distance + predecessor for path reconstruction. */
function shortestPaths(
  seeds: string[],
  adj: WeightedAdj
): {
  dist: Map<string, number>;
  prevNode: Map<string, string>;
  prevEdge: Map<string, string>;
} {
  const distMap = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, string>();
  const heap: Array<{ id: string; d: number }> = [];

  for (const s of seeds) {
    distMap.set(s, 0);
    heap.push({ id: s, d: 0 });
  }

  while (heap.length) {
    let bestI = 0;
    for (let i = 1; i < heap.length; i++) {
      if (heap[i].d < heap[bestI].d) bestI = i;
    }
    const { id: cur, d: curD } = heap.splice(bestI, 1)[0];
    if (curD > (distMap.get(cur) ?? Infinity)) continue;
    for (const nb of adj.get(cur) ?? []) {
      const nd = curD + nb.length;
      if (nd < (distMap.get(nb.to) ?? Infinity)) {
        distMap.set(nb.to, nd);
        prevNode.set(nb.to, cur);
        prevEdge.set(nb.to, nb.edgeId);
        heap.push({ id: nb.to, d: nd });
      }
    }
  }

  return { dist: distMap, prevNode, prevEdge };
}

function reconstructPath(
  target: string,
  prevNode: Map<string, string>,
  prevEdge: Map<string, string>
): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let cur: string | undefined = target;
  while (cur) {
    nodeIds.push(cur);
    const edge = prevEdge.get(cur);
    const prev = prevNode.get(cur);
    if (edge) edgeIds.push(edge);
    cur = prev;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds };
}

function emptyEgress(): EgressMetrics {
  return {
    sections: [],
    maxPathLength: null,
    avgPathLength: null,
    totalSeatsWithPath: 0,
    totalSeatsWithoutPath: 0,
    bottlenecks: [],
    clearanceMinutes: null,
    maxWalkMinutes: null,
  };
}

/**
 * Attach section access nodes and analyze reachability + egress toward exits
 * (falls back to stage / network when no exits are authored).
 */
export function analyzeCirculation(
  scene: ResolvedVenueScene,
  options?: CirculationOptions
): CirculationAnalysis {
  const accessRadius = options?.accessRadius ?? 80;
  const seatsPerWidthUnit = options?.seatsPerWidthUnit ?? EGRESS_DEFAULTS.seatsPerWidthUnit;
  const defaultAisleWidth = options?.defaultAisleWidth ?? EGRESS_DEFAULTS.aisleWidth;
  const mapUnitsPerMeter =
    options?.mapUnitsPerMeter ?? (scene.scale != null && scene.scale > 1 ? scene.scale : 40);
  const walkSpeedMps = options?.walkSpeedMps ?? EGRESS_DEFAULTS.walkSpeedMps;
  const flowOpts = {
    mapUnitsPerMeter,
    flowPerMeterLevel: options?.flowPerMeterLevel ?? EGRESS_DEFAULTS.flowPerMeterLevel,
    flowPerMeterStair: options?.flowPerMeterStair ?? EGRESS_DEFAULTS.flowPerMeterStair,
  };
  const graph = buildCirculationGraph(scene, options);
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const addEdge = (
    from: string,
    to: string,
    kind: CirculationEdge['kind'],
    length: number,
    meta?: { width?: number; sourceId?: string }
  ) => {
    if (from === to) return;
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    const id = `${kind}:${a}->${b}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({
      id,
      from,
      to,
      kind,
      length,
      width: meta?.width,
      sourceId: meta?.sourceId,
    });
  };

  const network = nodes.filter((n) => n.kind !== 'section');
  const exitNodes = nodes.filter((n) => n.kind === 'exit');
  const hasNetwork = network.some(
    (n) => n.kind === 'aisle' || n.kind === 'stair' || n.kind === 'exit'
  );

  for (const sec of scene.sections) {
    const seats = scene.seats.filter((s) => s.sectionId === sec.id);
    if (!seats.length && !sec.shape?.points?.length) continue;
    let cx: number;
    let cy: number;
    if (seats.length) {
      cx = seats.reduce((s, x) => s + x.x, 0) / seats.length;
      cy = seats.reduce((s, x) => s + x.y, 0) / seats.length;
    } else {
      const pts = sec.shape!.points;
      cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    }
    const nodeId = `section:${sec.id}`;
    const node: CirculationNode = {
      id: nodeId,
      kind: 'section',
      x: cx,
      y: cy,
      levelId: sec.levelId,
      label: sec.name,
      sectionId: sec.id,
    };
    nodes.push(node);
    byId.set(nodeId, node);

    let best: { id: string; d: number } | null = null;
    for (const n of network) {
      if (sec.levelId && n.levelId && sec.levelId !== n.levelId) continue;
      const d = dist(cx, cy, n.x, n.y);
      if (d <= accessRadius && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) addEdge(nodeId, best.id, 'access', best.d, { width: defaultAisleWidth });
  }

  const full: CirculationGraph = { nodes, edges };

  let seedMode: CirculationAnalysis['seedMode'] = 'network';
  let seeds: string[] = [];
  if (exitNodes.length) {
    seeds = exitNodes.map((n) => n.id);
    seedMode = 'exits';
  } else {
    const stageIds = nodes.filter((n) => n.kind === 'stage').map((n) => n.id);
    if (stageIds.length) {
      seeds = stageIds;
      seedMode = 'stage';
    } else {
      seeds = nodes.filter((n) => n.kind === 'aisle' || n.kind === 'stair').map((n) => n.id);
      seedMode = 'network';
    }
  }

  const adjSimple = new Map<string, string[]>();
  for (const e of edges) {
    const a = adjSimple.get(e.from) ?? [];
    a.push(e.to);
    adjSimple.set(e.from, a);
    const b = adjSimple.get(e.to) ?? [];
    b.push(e.from);
    adjSimple.set(e.to, b);
  }

  const reachable = new Set<string>();
  const queue = [...seeds];
  for (const s of seeds) reachable.add(s);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adjSimple.get(cur) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }

  const unreachableSections: string[] = [];
  if (hasNetwork) {
    for (const n of nodes) {
      if (n.kind !== 'section' || !n.sectionId) continue;
      if (!reachable.has(n.id)) unreachableSections.push(n.sectionId);
    }
  }

  let egress = emptyEgress();
  if (hasNetwork && seeds.length) {
    const wAdj = buildWeightedAdj(edges);
    const { dist: distMap, prevNode, prevEdge } = shortestPaths(seeds, wAdj);
    const edgeById = new Map(edges.map((e) => [e.id, e]));
    const loadByEdge = new Map<string, { sections: Set<string>; seats: number }>();

    const sectionEgress: SectionEgress[] = [];
    let pathSum = 0;
    let pathCount = 0;
    let seatsWith = 0;
    let seatsWithout = 0;
    let maxLen: number | null = null;

    // First pass: path lengths + edge loads
    const pending: Array<{
      sectionId: string;
      sectionName?: string;
      seatCount: number;
      pathLength: number | null;
      pathNodeIds: string[];
      pathEdgeIds: string[];
    }> = [];

    for (const n of nodes) {
      if (n.kind !== 'section' || !n.sectionId) continue;
      const seatCount = scene.seats.filter((s) => s.sectionId === n.sectionId).length;
      const pathLen = distMap.has(n.id) ? distMap.get(n.id)! : null;
      let pathNodeIds: string[] = [];
      let pathEdgeIds: string[] = [];
      if (pathLen != null) {
        const path = reconstructPath(n.id, prevNode, prevEdge);
        pathNodeIds = path.nodeIds;
        pathEdgeIds = path.edgeIds;
        pathSum += pathLen;
        pathCount += 1;
        seatsWith += seatCount;
        if (maxLen == null || pathLen > maxLen) maxLen = pathLen;
        for (const eid of pathEdgeIds) {
          const bucket = loadByEdge.get(eid) ?? { sections: new Set(), seats: 0 };
          bucket.sections.add(n.sectionId);
          bucket.seats += seatCount;
          loadByEdge.set(eid, bucket);
        }
      } else {
        seatsWithout += seatCount;
      }
      pending.push({
        sectionId: n.sectionId,
        sectionName: n.label,
        seatCount,
        pathLength: pathLen,
        pathNodeIds,
        pathEdgeIds,
      });
    }

    const bottlenecks: EgressBottleneck[] = Array.from(loadByEdge.entries())
      .map(([edgeId, load]) => {
        const e = edgeById.get(edgeId)!;
        const width = e.width ?? defaultAisleWidth;
        const capacity = edgeCapacity(width, seatsPerWidthUnit);
        const utilization = load.seats / capacity;
        const flowPerMinute = edgeFlowPerMinute(width, e.kind, flowOpts);
        const clearanceMinutes = load.seats / flowPerMinute;
        return {
          edgeId,
          kind: e.kind,
          length: e.length,
          width,
          capacity,
          sectionCount: load.sections.size,
          seatLoad: load.seats,
          utilization,
          loadScore: load.seats / Math.max(e.length, 1),
          overCapacity: utilization > 1,
          flowPerMinute,
          clearanceMinutes,
        };
      })
      .filter(
        (b) => b.kind === 'aisle' || b.kind === 'stair' || b.kind === 'link' || b.kind === 'exit'
      )
      .sort(
        (a, b) =>
          Number(b.overCapacity) - Number(a.overCapacity) ||
          b.clearanceMinutes - a.clearanceMinutes ||
          b.utilization - a.utilization
      )
      .slice(0, 8);

    // Index all loaded edges for section queue calc
    const allEdgeClearance = new Map(
      Array.from(loadByEdge.entries()).map(([edgeId, load]) => {
        const e = edgeById.get(edgeId)!;
        const width = e.width ?? defaultAisleWidth;
        const flow = edgeFlowPerMinute(width, e.kind, flowOpts);
        return [edgeId, load.seats / flow] as const;
      })
    );

    let maxWalk: number | null = null;
    let venueClearance: number | null = null;

    for (const p of pending) {
      let walkMinutes: number | null = null;
      let queueMinutes: number | null = null;
      let clearanceMinutes: number | null = null;
      if (p.pathLength != null) {
        const pathMeters = p.pathLength / Math.max(mapUnitsPerMeter, 1);
        walkMinutes = pathMeters / Math.max(walkSpeedMps, 0.1) / 60;
        queueMinutes = 0;
        for (const eid of p.pathEdgeIds) {
          const q = allEdgeClearance.get(eid) ?? 0;
          if (q > queueMinutes) queueMinutes = q;
        }
        clearanceMinutes = walkMinutes + (queueMinutes ?? 0);
        if (maxWalk == null || walkMinutes > maxWalk) maxWalk = walkMinutes;
        if (venueClearance == null || clearanceMinutes > venueClearance) {
          venueClearance = clearanceMinutes;
        }
      }
      sectionEgress.push({
        ...p,
        walkMinutes,
        queueMinutes,
        clearanceMinutes,
      });
    }

    for (const bn of bottlenecks) {
      if (venueClearance == null || bn.clearanceMinutes > venueClearance) {
        venueClearance = bn.clearanceMinutes;
      }
    }

    egress = {
      sections: sectionEgress,
      maxPathLength: maxLen,
      avgPathLength: pathCount ? pathSum / pathCount : null,
      totalSeatsWithPath: seatsWith,
      totalSeatsWithoutPath: seatsWithout,
      bottlenecks,
      clearanceMinutes: venueClearance,
      maxWalkMinutes: maxWalk,
    };
  }

  return {
    graph: full,
    reachableFromStage: Array.from(reachable),
    unreachableSections,
    hasNetwork,
    seedMode,
    exitCount: exitNodes.length,
    egress,
  };
}

/** Untagged nodes stay visible (same rule as 2D level filters). */
export function circulationNodeTouchesLevel(node: CirculationNode, levelId?: string): boolean {
  if (!levelId) return true;
  if (!node.levelId) return true;
  return node.levelId === levelId;
}

/**
 * Filter circulation graph for a venue level.
 * Same-level edges require both ends; stairs/links keep if either end touches the level.
 */
export function filterCirculationGraph(
  graph: CirculationGraph,
  levelId?: string
): CirculationGraph {
  if (!levelId) return graph;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return false;
    const aOk = circulationNodeTouchesLevel(a, levelId);
    const bOk = circulationNodeTouchesLevel(b, levelId);
    if (e.kind === 'stair' || e.kind === 'link') return aOk || bOk;
    return aOk && bOk;
  });
  const keep = new Set<string>();
  for (const e of edges) {
    keep.add(e.from);
    keep.add(e.to);
  }
  for (const n of graph.nodes) {
    if (circulationNodeTouchesLevel(n, levelId)) keep.add(n.id);
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges,
  };
}
