import type { SeatMapData, SeatMapBounds } from '@boletera/shared';
import { computeMapBounds } from '../map-utils';
import { bakeSeatColors } from './colors';
import {
  buildLodAggregates,
  type RowAggregate,
  type SectionAggregate,
} from './lod';
import { estimateCellSize, SpatialIndex } from './spatial-index';
import type {
  ColorMode,
  ColorModeContext,
  SeatPatch,
  WorldRect,
} from './types';

export type SceneBuffers = {
  seatCount: number;
  seatIds: string[];
  /** SoA world X. */
  xs: Float32Array;
  /** SoA world Y. */
  ys: Float32Array;
  /** Packed RGBA (N×4). */
  colors: Float32Array;
  /** Per-instance scale multiplier (1 = default radius). */
  scales: Float32Array;
  /** 0=normal 1=selected 2=dimmed — cheap GPU branch. */
  flags: Uint8Array;
  labels: string[];
  rows: (string | undefined)[];
  tiers: (string | undefined)[];
  seatSectionIndex: Uint32Array;
  sectionIds: string[];
  sectionNames: string[];
  sectionSlugs: string[];
  sectionColors: string[];
  /** Heat proxy 0..1 for section LOD (from sightline/price bake). */
  heats: Float32Array;
  bounds: SeatMapBounds;
  index: SpatialIndex;
  indexBuildMs: number;
  sectionAggs: SectionAggregate[];
  rowAggs: RowAggregate[];
  /** id → dense index for O(1) patches. */
  idToIndex: Map<string, number>;
  colorMode: ColorMode;
  colorContext: ColorModeContext;
  seatRadius: number;
  /** Stage / furniture / shapes kept as light refs for vector layers. */
  map: SeatMapData;
};

function emptyBounds(): SeatMapBounds {
  return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
}

/**
 * Flatten SeatMapData into typed arrays + spatial index.
 * This is the only place that walks the nested section/seat object graph;
 * the render hot path never touches those objects again.
 */
export function buildSceneBuffers(
  data: SeatMapData,
  opts: {
    colorMode?: ColorMode;
    colorContext?: ColorModeContext;
    seatRadius?: number;
    cellSize?: number;
  } = {},
): SceneBuffers {
  const colorMode = opts.colorMode ?? 'zone';
  const colorContext = opts.colorContext ?? {};
  const seatRadius = opts.seatRadius ?? 6;

  let seatCount = 0;
  for (const sec of data.sections) seatCount += sec.seats.length;

  const seatIds = new Array<string>(seatCount);
  const xs = new Float32Array(seatCount);
  const ys = new Float32Array(seatCount);
  const colors = new Float32Array(seatCount * 4);
  const scales = new Float32Array(seatCount);
  const flags = new Uint8Array(seatCount);
  const labels = new Array<string>(seatCount);
  const rows = new Array<string | undefined>(seatCount);
  const tiers = new Array<string | undefined>(seatCount);
  const authoredColors = new Array<string | undefined>(seatCount);
  const seatSectionIndex = new Uint32Array(seatCount);
  const heats = new Float32Array(seatCount);

  const sectionIds: string[] = [];
  const sectionNames: string[] = [];
  const sectionSlugs: string[] = [];
  const sectionColors: string[] = [];
  const idToIndex = new Map<string, number>();

  let i = 0;
  for (let si = 0; si < data.sections.length; si++) {
    const sec = data.sections[si];
    sectionIds.push(sec.id);
    sectionNames.push(sec.name);
    sectionSlugs.push(sec.slug);
    sectionColors.push(sec.color);
    for (const seat of sec.seats) {
      seatIds[i] = seat.id;
      xs[i] = seat.x;
      ys[i] = seat.y;
      scales[i] = 1;
      flags[i] = 0;
      labels[i] = seat.label;
      rows[i] = seat.row;
      tiers[i] = seat.tier;
      authoredColors[i] = undefined;
      seatSectionIndex[i] = si;
      idToIndex.set(seat.id, i);
      i++;
    }
  }

  const bounds = seatCount > 0 ? computeMapBounds(data, 24) : emptyBounds();
  const worldRect: WorldRect = {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const cellSize = estimateCellSize(worldRect, seatCount, opts.cellSize);
  const index = new SpatialIndex(xs, ys, worldRect, cellSize);
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  bakeSeatColors(
    {
      mode: colorMode,
      context: colorContext,
      seatIds,
      sectionSlugs,
      sectionNames,
      sectionColors,
      seatSectionIndex,
      tiers,
      authoredColors,
    },
    colors,
  );

  // Heats: derive from baked luminance as a cheap LOD proxy.
  for (let s = 0; s < seatCount; s++) {
    const o = s * 4;
    heats[s] = colors[o] * 0.3 + colors[o + 1] * 0.59 + colors[o + 2] * 0.11;
  }

  const { sections: sectionAggs, rows: rowAggs } = buildLodAggregates(
    sectionIds,
    sectionNames,
    sectionColors,
    rows,
    xs,
    ys,
    heats,
    seatSectionIndex,
  );

  return {
    seatCount,
    seatIds,
    xs,
    ys,
    colors,
    scales,
    flags,
    labels,
    rows,
    tiers,
    seatSectionIndex,
    sectionIds,
    sectionNames,
    sectionSlugs,
    sectionColors,
    heats,
    bounds,
    index,
    indexBuildMs: t1 - t0,
    sectionAggs,
    rowAggs,
    idToIndex,
    colorMode,
    colorContext,
    seatRadius,
    map: data,
  };
}

/** Incremental seat updates without rebuilding the spatial index when positions unchanged. */
export function applySeatPatches(scene: SceneBuffers, patches: readonly SeatPatch[]): boolean {
  let positionsChanged = false;
  let colorsDirty = false;

  for (const p of patches) {
    const idx = scene.idToIndex.get(p.id);
    if (idx === undefined) continue;
    if (p.x !== undefined && p.x !== scene.xs[idx]) {
      scene.xs[idx] = p.x;
      positionsChanged = true;
    }
    if (p.y !== undefined && p.y !== scene.ys[idx]) {
      scene.ys[idx] = p.y;
      positionsChanged = true;
    }
    if (p.scale !== undefined) scene.scales[idx] = p.scale;
    if (p.label !== undefined) scene.labels[idx] = p.label;
    if (p.row !== undefined) scene.rows[idx] = p.row;
    if (p.tier !== undefined) {
      scene.tiers[idx] = p.tier;
      colorsDirty = true;
    }
    if (p.selected === true) scene.flags[idx] = 1;
    else if (p.selected === false && scene.flags[idx] === 1) scene.flags[idx] = 0;

    if (p.status || p.price !== undefined || p.sightlineScore !== undefined || p.color) {
      colorsDirty = true;
      const ctx = { ...scene.colorContext };
      if (p.status) {
        const map = new Map(
          scene.colorContext.statusBySeatId instanceof Map
            ? scene.colorContext.statusBySeatId
            : Object.entries(scene.colorContext.statusBySeatId ?? {}),
        );
        map.set(p.id, p.status);
        ctx.statusBySeatId = map;
      }
      if (p.price !== undefined) {
        const map = new Map(
          scene.colorContext.priceBySeatId instanceof Map
            ? scene.colorContext.priceBySeatId
            : Object.entries(scene.colorContext.priceBySeatId ?? {}),
        );
        map.set(p.id, p.price);
        ctx.priceBySeatId = map;
      }
      if (p.sightlineScore !== undefined) {
        const map = new Map(
          scene.colorContext.sightlineBySeatId instanceof Map
            ? scene.colorContext.sightlineBySeatId
            : Object.entries(scene.colorContext.sightlineBySeatId ?? {}),
        );
        map.set(p.id, p.sightlineScore);
        ctx.sightlineBySeatId = map;
      }
      scene.colorContext = ctx;
    }
  }

  if (colorsDirty) {
    rebakeColors(scene);
  }

  if (positionsChanged) {
    const worldRect: WorldRect = {
      minX: scene.bounds.minX,
      minY: scene.bounds.minY,
      maxX: scene.bounds.maxX,
      maxY: scene.bounds.maxY,
    };
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    scene.index = new SpatialIndex(scene.xs, scene.ys, worldRect, scene.index.cellSize);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    scene.indexBuildMs = t1 - t0;
  }

  return positionsChanged || colorsDirty || patches.length > 0;
}

export function rebakeColors(scene: SceneBuffers): void {
  bakeSeatColors(
    {
      mode: scene.colorMode,
      context: scene.colorContext,
      seatIds: scene.seatIds,
      sectionSlugs: scene.sectionSlugs,
      sectionNames: scene.sectionNames,
      sectionColors: scene.sectionColors,
      seatSectionIndex: scene.seatSectionIndex,
      tiers: scene.tiers,
    },
    scene.colors,
  );
  for (let s = 0; s < scene.seatCount; s++) {
    const o = s * 4;
    scene.heats[s] = scene.colors[o] * 0.3 + scene.colors[o + 1] * 0.59 + scene.colors[o + 2] * 0.11;
  }
}

/** Generate a synthetic rectangular venue for benchmarks (no geometry domain deps). */
export function generateSyntheticVenue(seatCount: number, seatsPerRow = 100): SeatMapData {
  const rows = Math.ceil(seatCount / seatsPerRow);
  const seatPitch = 20;
  const rowPitch = 24;
  const seats: SeatMapData['sections'][0]['seats'] = [];
  let n = 0;
  for (let r = 0; r < rows && n < seatCount; r++) {
    for (let c = 0; c < seatsPerRow && n < seatCount; c++) {
      seats.push({
        id: `s${n}`,
        label: `${r + 1}-${c + 1}`,
        row: String(r + 1),
        x: c * seatPitch,
        y: r * rowPitch,
        tier: c < seatsPerRow / 3 ? 'A' : c < (2 * seatsPerRow) / 3 ? 'B' : 'C',
      });
      n++;
    }
  }
  return {
    version: 3,
    sections: [
      {
        id: 'sec-main',
        name: 'Main',
        slug: 'main',
        color: '#5b9fd4',
        seats,
      },
    ],
    venue: {
      units: 'map',
      scale: 40,
      stage: { x: (seatsPerRow * seatPitch) / 2 - 80, y: -60, width: 160 },
    },
  };
}
