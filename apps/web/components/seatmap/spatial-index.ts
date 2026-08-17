/**
 * Rejilla uniforme sobre el plano del recinto.
 *
 * Dos usos, y los dos son la diferencia entre 45.000 butacas y una pantalla que
 * se congela:
 *  1. Hit-testing: un `pointermove` no puede recorrer 45.000 asientos. Con la
 *     rejilla se miran ~9 celdas (unas decenas de butacas).
 *  2. Culling de dibujo: cuando hay zoom, sólo se recorren las celdas visibles
 *     en vez de todo el aforo.
 *
 * Los datos se guardan en typed arrays con el patrón CSR (offsets + items) en
 * vez de un array de arrays: 45.000 arrays pequeños son 45.000 objetos que el
 * GC tiene que perseguir en un móvil de gama media.
 */

import type { Bounds } from './types';

export type SeatGrid = {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  /** Offsets CSR: los índices de la celda i van de starts[i] a starts[i+1]. */
  starts: Int32Array;
  items: Int32Array;
};

export type PointLike = { x: number; y: number };

/**
 * Paso medio entre butacas estimado por densidad. Se usa para decidir umbrales
 * de zoom sin tener que medir vecinos reales (que costaría O(n log n)).
 */
export function estimateSeatPitch(seatCount: number, bounds: Bounds): number {
  if (seatCount <= 1) return 24;
  const area = Math.max(bounds.width * bounds.height, 1);
  // Las butacas no llenan todo el bounding box (pasillos, escenario, huecos):
  // el 0.55 lo compensa para no sobrestimar el paso.
  const pitch = Math.sqrt((area * 0.55) / seatCount);
  return Math.min(Math.max(pitch, 4), 120);
}

export function buildSeatGrid(seats: readonly PointLike[], bounds: Bounds): SeatGrid {
  // ~64 butacas por celda: suficiente para que el hit-test mire poco y para que
  // el culling no tenga que recorrer miles de celdas vacías.
  const pitch = estimateSeatPitch(seats.length, bounds);
  const cell = Math.max(pitch * 8, 1);
  const cols = Math.max(1, Math.ceil(bounds.width / cell));
  const rows = Math.max(1, Math.ceil(bounds.height / cell));
  const cellCount = cols * rows;

  const counts = new Int32Array(cellCount);
  const cellOf = new Int32Array(seats.length);

  for (let i = 0; i < seats.length; i++) {
    const cx = clampInt(Math.floor((seats[i].x - bounds.minX) / cell), 0, cols - 1);
    const cy = clampInt(Math.floor((seats[i].y - bounds.minY) / cell), 0, rows - 1);
    const idx = cy * cols + cx;
    cellOf[i] = idx;
    counts[idx] += 1;
  }

  const starts = new Int32Array(cellCount + 1);
  for (let i = 0; i < cellCount; i++) starts[i + 1] = starts[i] + counts[i];

  const cursor = starts.slice(0, cellCount);
  const items = new Int32Array(seats.length);
  for (let i = 0; i < seats.length; i++) {
    items[cursor[cellOf[i]]++] = i;
  }

  return { minX: bounds.minX, minY: bounds.minY, cell, cols, rows, starts, items };
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Recorre los índices de butaca cuyas celdas cortan el rectángulo (mundo).
 * El callback puede recibir butacas ligeramente fuera del rect: quien dibuja
 * las recorta después, y ahorrarse la comprobación exacta aquí es más barato.
 */
export function forEachSeatInRect(
  grid: SeatGrid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (seatIndex: number) => void,
): void {
  const c0 = clampInt(Math.floor((minX - grid.minX) / grid.cell), 0, grid.cols - 1);
  const c1 = clampInt(Math.floor((maxX - grid.minX) / grid.cell), 0, grid.cols - 1);
  const r0 = clampInt(Math.floor((minY - grid.minY) / grid.cell), 0, grid.rows - 1);
  const r1 = clampInt(Math.floor((maxY - grid.minY) / grid.cell), 0, grid.rows - 1);

  for (let r = r0; r <= r1; r++) {
    const rowBase = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      const cellIdx = rowBase + c;
      const end = grid.starts[cellIdx + 1];
      for (let k = grid.starts[cellIdx]; k < end; k++) visit(grid.items[k]);
    }
  }
}

/**
 * Butaca más cercana al punto dentro de `maxDist` (unidades de mundo).
 * Devuelve -1 si no hay ninguna: el radio de toque lo decide quien llama, para
 * poder cumplir los 24×24 px de WCAG 2.2 sin cambiar el radio dibujado.
 */
export function findNearestSeat(
  grid: SeatGrid,
  seats: readonly PointLike[],
  x: number,
  y: number,
  maxDist: number,
  accept?: (seatIndex: number) => boolean,
): number {
  let best = -1;
  let bestDist = maxDist * maxDist;
  forEachSeatInRect(grid, x - maxDist, y - maxDist, x + maxDist, y + maxDist, (i) => {
    if (accept && !accept(i)) return;
    const dx = seats[i].x - x;
    const dy = seats[i].y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist) {
      bestDist = d2;
      best = i;
    }
  });
  return best;
}
