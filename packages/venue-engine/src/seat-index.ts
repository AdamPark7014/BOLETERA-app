/**
 * Índice espacial columnar de butacas.
 *
 * A 45.000 butacas, el documento de mapa (`SeatMapData`) es una lista de objetos
 * JS con ids de texto: recorrerlo por cada cuadro de render, por cada movimiento
 * del ratón o por cada selección cuesta decenas de milisegundos y genera basura
 * que dispara el recolector. Este módulo lo convierte una sola vez en arrays
 * tipados (estructura de datos columnar) más una rejilla espacial, de modo que:
 *
 *   · el render solo recorre las butacas visibles (culling por viewport),
 *   · la selección por rectángulo consulta celdas, no las 45.000 butacas,
 *   · el impacto de clic es O(celdas vecinas) en lugar de O(n),
 *   · alejando el mapa se dibujan agregados, no butacas.
 *
 * El índice es de solo lectura: se reconstruye cuando cambia la geometría, no
 * cuando cambia la selección o el zoom.
 *
 * Identificadores en inglés, comentarios de dominio en español.
 */

import type { SeatMapData, SeatMapSeat } from '@boletera/shared';

/** Banderas por butaca empaquetadas en un byte. */
export const SEAT_FLAG = {
  BLOCKED: 1 << 0,
  RESTRICTED: 1 << 1,
  PREMIUM_VIEW: 1 << 2,
  ACCESSIBLE: 1 << 3,
  COMPANION: 1 << 4,
  /** La sección está bloqueada en el editor. */
  LOCKED: 1 << 5,
} as const;

export type SectionMeta = {
  id: string;
  name: string;
  slug: string;
  color: string;
  levelId?: string;
  locked: boolean;
  /** Número de butacas de la sección. */
  seatCount: number;
  /** Centroide, para etiquetas y para el nivel de detalle agregado. */
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Contorno autorado, si lo hay. */
  shape?: [number, number][];
};

export type SeatIndex = {
  count: number;
  /** Coordenadas de plano. */
  x: Float32Array;
  y: Float32Array;
  /** Índice de sección (posición en `sections`). */
  sectionIdx: Uint16Array;
  /** Índice de nivel arquitectónico (posición en `levels`); 0xffff = sin nivel. */
  levelIdx: Uint16Array;
  /** Índice de tarifa (posición en `tiers`). */
  tierIdx: Uint8Array;
  /** Banderas `SEAT_FLAG`. */
  flags: Uint8Array;
  /** Rotación en grados. */
  rotation: Float32Array;
  /** Ids de butaca por índice (para hablar con el documento). */
  ids: string[];
  /** Etiquetas visibles (fila-número). */
  labels: string[];
  idToIdx: Map<string, number>;
  sections: SectionMeta[];
  tiers: string[];
  levels: string[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Paso medio entre butacas, usado para dimensionar la rejilla y el impacto. */
  pitch: number;
  grid: SpatialGrid;
};

/**
 * Rejilla uniforme en formato disperso comprimido (CSR).
 * `cellStart[c]`..`cellStart[c+1]` delimita los índices de butaca de la celda `c`
 * dentro de `cellItems`. Sin arrays anidados: una sola reserva de memoria.
 */
export type SpatialGrid = {
  cols: number;
  rows: number;
  cellSize: number;
  minX: number;
  minY: number;
  cellStart: Int32Array;
  cellItems: Int32Array;
};

function seatFlags(seat: SeatMapSeat, sectionLocked: boolean): number {
  let f = 0;
  if (seat.visibility?.blocked) f |= SEAT_FLAG.BLOCKED;
  if (seat.visibility?.restrictedView) f |= SEAT_FLAG.RESTRICTED;
  if (seat.visibility?.premiumView) f |= SEAT_FLAG.PREMIUM_VIEW;
  const meta = seat.metadata as Record<string, unknown> | undefined;
  if (meta?.accessible === true) {
    f |= SEAT_FLAG.ACCESSIBLE;
    if (meta.accessibleKind === 'companion') f |= SEAT_FLAG.COMPANION;
  }
  if (sectionLocked) f |= SEAT_FLAG.LOCKED;
  return f;
}

/** Construye el índice columnar. Coste O(n); se reconstruye solo al cambiar geometría. */
export function buildSeatIndex(map: SeatMapData): SeatIndex {
  const sectionsIn = map.sections ?? [];

  let count = 0;
  for (const s of sectionsIn) count += s.seats.length;

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const sectionIdx = new Uint16Array(count);
  const levelIdx = new Uint16Array(count);
  const tierIdx = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const rotation = new Float32Array(count);
  const ids: string[] = new Array(count);
  const labels: string[] = new Array(count);
  const idToIdx = new Map<string, number>();

  const tiers: string[] = [];
  const tierLookup = new Map<string, number>();
  const levels: string[] = [];
  const levelLookup = new Map<string, number>();

  const sections: SectionMeta[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let w = 0;
  for (let si = 0; si < sectionsIn.length; si++) {
    const sec = sectionsIn[si];
    const locked = Boolean(sec.locked);

    let sMinX = Infinity;
    let sMinY = Infinity;
    let sMaxX = -Infinity;
    let sMaxY = -Infinity;
    let sumX = 0;
    let sumY = 0;

    for (const seat of sec.seats) {
      const sx = seat.x;
      const sy = seat.y;
      x[w] = sx;
      y[w] = sy;
      sectionIdx[w] = si;
      rotation[w] = seat.rotation ?? 0;
      flags[w] = seatFlags(seat, locked);

      const tier = seat.tier ?? 'standard';
      let ti = tierLookup.get(tier);
      if (ti === undefined) {
        ti = tiers.length;
        tiers.push(tier);
        tierLookup.set(tier, ti);
      }
      tierIdx[w] = ti;

      const lvl = seat.levelId ?? sec.levelId;
      if (lvl) {
        let li = levelLookup.get(lvl);
        if (li === undefined) {
          li = levels.length;
          levels.push(lvl);
          levelLookup.set(lvl, li);
        }
        levelIdx[w] = li;
      } else {
        levelIdx[w] = 0xffff;
      }

      ids[w] = seat.id;
      labels[w] = seat.label;
      idToIdx.set(seat.id, w);

      if (sx < sMinX) sMinX = sx;
      if (sy < sMinY) sMinY = sy;
      if (sx > sMaxX) sMaxX = sx;
      if (sy > sMaxY) sMaxY = sy;
      sumX += sx;
      sumY += sy;
      w++;
    }

    const n = sec.seats.length;
    // Una sección sin butacas conserva su contorno para poder dibujarla y avisar.
    const hasSeats = n > 0;
    if (hasSeats) {
      if (sMinX < minX) minX = sMinX;
      if (sMinY < minY) minY = sMinY;
      if (sMaxX > maxX) maxX = sMaxX;
      if (sMaxY > maxY) maxY = sMaxY;
    }

    sections.push({
      id: sec.id,
      name: sec.name,
      slug: sec.slug,
      color: sec.color,
      levelId: sec.levelId,
      locked,
      seatCount: n,
      cx: hasSeats ? sumX / n : 0,
      cy: hasSeats ? sumY / n : 0,
      minX: hasSeats ? sMinX : 0,
      minY: hasSeats ? sMinY : 0,
      maxX: hasSeats ? sMaxX : 0,
      maxY: hasSeats ? sMaxY : 0,
      shape: sec.shape?.points,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const pitch = estimatePitch(sectionsIn);
  const grid = buildGrid(x, y, count, minX, minY, maxX, maxY, Math.max(pitch * 2, 8));

  return {
    count,
    x,
    y,
    sectionIdx,
    levelIdx,
    tierIdx,
    flags,
    rotation,
    ids,
    labels,
    idToIdx,
    sections,
    tiers,
    levels,
    bounds: { minX, minY, maxX, maxY },
    pitch,
    grid,
  };
}

/** Paso medio entre butacas: mediana aproximada de los pasos declarados. */
function estimatePitch(sections: SeatMapData['sections']): number {
  const pitches = sections
    .map((s) => s.seatPitch)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  if (!pitches.length) return 26;
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)];
}

function buildGrid(
  x: Float32Array,
  y: Float32Array,
  count: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cellSize: number,
): SpatialGrid {
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);
  const cellCount = cols * rows;

  // Paso 1: contar por celda.
  const counts = new Int32Array(cellCount);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x[i] - minX) / cellSize)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((y[i] - minY) / cellSize)));
    const c = cy * cols + cx;
    cellOf[i] = c;
    counts[c]++;
  }

  // Paso 2: prefijos.
  const cellStart = new Int32Array(cellCount + 1);
  let acc = 0;
  for (let c = 0; c < cellCount; c++) {
    cellStart[c] = acc;
    acc += counts[c];
  }
  cellStart[cellCount] = acc;

  // Paso 3: colocar.
  const cursor = cellStart.slice(0, cellCount);
  const cellItems = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    cellItems[cursor[cellOf[i]]++] = i;
  }

  return { cols, rows, cellSize, minX, minY, cellStart, cellItems };
}

/**
 * Índices de butaca dentro de un rectángulo de mundo.
 * Recorre solo las celdas que el rectángulo toca.
 */
export function querySeatsInRect(
  index: SeatIndex,
  rMinX: number,
  rMinY: number,
  rMaxX: number,
  rMaxY: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  const { grid, x, y } = index;
  const c0 = Math.max(0, Math.floor((rMinX - grid.minX) / grid.cellSize));
  const c1 = Math.min(grid.cols - 1, Math.floor((rMaxX - grid.minX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((rMinY - grid.minY) / grid.cellSize));
  const r1 = Math.min(grid.rows - 1, Math.floor((rMaxY - grid.minY) / grid.cellSize));
  if (c1 < c0 || r1 < r0) return out;

  for (let r = r0; r <= r1; r++) {
    const base = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      const cell = base + c;
      const from = grid.cellStart[cell];
      const to = grid.cellStart[cell + 1];
      for (let k = from; k < to; k++) {
        const i = grid.cellItems[k];
        const px = x[i];
        const py = y[i];
        if (px >= rMinX && px <= rMaxX && py >= rMinY && py <= rMaxY) out.push(i);
      }
    }
  }
  return out;
}

/** Butaca más cercana a un punto dentro de `radius`, o -1. */
export function hitTestSeat(index: SeatIndex, px: number, py: number, radius: number): number {
  const { grid, x, y } = index;
  const c0 = Math.max(0, Math.floor((px - radius - grid.minX) / grid.cellSize));
  const c1 = Math.min(grid.cols - 1, Math.floor((px + radius - grid.minX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((py - radius - grid.minY) / grid.cellSize));
  const r1 = Math.min(grid.rows - 1, Math.floor((py + radius - grid.minY) / grid.cellSize));

  let best = -1;
  let bestD2 = radius * radius;
  for (let r = r0; r <= r1; r++) {
    const base = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      const cell = base + c;
      const from = grid.cellStart[cell];
      const to = grid.cellStart[cell + 1];
      for (let k = from; k < to; k++) {
        const i = grid.cellItems[k];
        const dx = x[i] - px;
        const dy = y[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
  }
  return best;
}

/* ── Nivel de detalle ─────────────────────────────────────────────────────── */

export type LodMode =
  /** Solo polígonos de sección con recuento: mapa completo a la vista. */
  | 'sections'
  /** Celdas agregadas de densidad: zoom intermedio. */
  | 'clusters'
  /** Butacas individuales: zoom de trabajo. */
  | 'seats';

export type LodThresholds = {
  /** Escala a partir de la cual se pintan celdas agregadas. */
  clusters: number;
  /** Escala a partir de la cual se pintan butacas individuales. */
  seats: number;
};

/**
 * Umbrales por defecto en píxeles de pantalla por unidad de mapa.
 * Con paso 26 y escala 0.55, una butaca ocupa ~14 px: por debajo de eso el
 * detalle individual no aporta y sí cuesta.
 */
export const DEFAULT_LOD: LodThresholds = { clusters: 0.22, seats: 0.55 };

export function lodModeFor(scale: number, thresholds: LodThresholds = DEFAULT_LOD): LodMode {
  if (scale >= thresholds.seats) return 'seats';
  if (scale >= thresholds.clusters) return 'clusters';
  return 'sections';
}

export type Cluster = {
  /** Centro en coordenadas de mundo. */
  cx: number;
  cy: number;
  count: number;
  /** Sección dominante de la celda (para el color). */
  sectionIdx: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * Agrega las butacas visibles en celdas de tamaño `cellWorld`.
 * Se usa en el nivel intermedio: en vez de 40.000 rectángulos se dibujan unos
 * cientos de manchas de densidad que conservan la forma del recinto.
 */
export function buildClusters(
  index: SeatIndex,
  viewMinX: number,
  viewMinY: number,
  viewMaxX: number,
  viewMaxY: number,
  cellWorld: number,
): Cluster[] {
  const { x, y, sectionIdx } = index;
  const cols = Math.max(1, Math.ceil((viewMaxX - viewMinX) / cellWorld));
  const rows = Math.max(1, Math.ceil((viewMaxY - viewMinY) / cellWorld));
  const map = new Map<number, Cluster & { sectionTally: Map<number, number> }>();

  const scratch: number[] = [];
  querySeatsInRect(index, viewMinX, viewMinY, viewMaxX, viewMaxY, scratch);

  for (const i of scratch) {
    const c = Math.min(cols - 1, Math.floor((x[i] - viewMinX) / cellWorld));
    const r = Math.min(rows - 1, Math.floor((y[i] - viewMinY) / cellWorld));
    const key = r * cols + c;
    let cluster = map.get(key);
    if (!cluster) {
      cluster = {
        cx: 0,
        cy: 0,
        count: 0,
        sectionIdx: sectionIdx[i],
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        sectionTally: new Map(),
      };
      map.set(key, cluster);
    }
    cluster.cx += x[i];
    cluster.cy += y[i];
    cluster.count++;
    if (x[i] < cluster.minX) cluster.minX = x[i];
    if (y[i] < cluster.minY) cluster.minY = y[i];
    if (x[i] > cluster.maxX) cluster.maxX = x[i];
    if (y[i] > cluster.maxY) cluster.maxY = y[i];
    const s = sectionIdx[i];
    cluster.sectionTally.set(s, (cluster.sectionTally.get(s) ?? 0) + 1);
  }

  const out: Cluster[] = [];
  for (const cluster of map.values()) {
    let bestSection = cluster.sectionIdx;
    let bestN = 0;
    for (const [s, n] of cluster.sectionTally) {
      if (n > bestN) {
        bestN = n;
        bestSection = s;
      }
    }
    out.push({
      cx: cluster.cx / cluster.count,
      cy: cluster.cy / cluster.count,
      count: cluster.count,
      sectionIdx: bestSection,
      minX: cluster.minX,
      minY: cluster.minY,
      maxX: cluster.maxX,
      maxY: cluster.maxY,
    });
  }
  return out;
}

/** Índices de butaca de una sección (recorrido lineal, sin asignaciones extra). */
export function seatsOfSection(index: SeatIndex, sectionIdx: number, out: number[] = []): number[] {
  out.length = 0;
  const { sectionIdx: sIdx, count } = index;
  for (let i = 0; i < count; i++) if (sIdx[i] === sectionIdx) out.push(i);
  return out;
}

/** Traduce índices internos a ids de butaca. */
export function toSeatIds(index: SeatIndex, indices: Iterable<number>): string[] {
  const out: string[] = [];
  for (const i of indices) out.push(index.ids[i]);
  return out;
}

/** Traduce ids a índices internos, ignorando los desconocidos. */
export function toSeatIndices(index: SeatIndex, ids: Iterable<string>): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const i = index.idToIdx.get(id);
    if (i !== undefined) out.push(i);
  }
  return out;
}
