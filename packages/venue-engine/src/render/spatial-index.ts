import { rectIntersects, rectContainsPoint, pointInPolygon } from './math';
import type { WorldPoint, WorldRect } from './types';

/**
 * Uniform spatial hash for dense seat fields.
 *
 * Why not a quadtree? Venue seats are near-uniformly distributed inside
 * section blocks. A fixed grid gives O(1) insert and O(k) range queries
 * with excellent cache locality via packed Uint32 index lists — typically
 * faster than pointer-chasing quadtrees at 100k–250k points.
 *
 * Cell size should be ≈ 2–4× average seat pitch so a screen-sized query
 * touches a handful of cells, not thousands of tiny ones.
 */
export class SpatialIndex {
  readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly originX: number;
  private readonly originY: number;
  /** Per-cell packed seat indices. */
  private readonly cells: Uint32Array[];
  private readonly count: number;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;

  /**
   * @param xs / ys - SoA positions (length = seatCount)
   * @param bounds - World AABB covering all seats (used to size the grid)
   * @param cellSize - World units per cell
   */
  constructor(
    xs: Float32Array,
    ys: Float32Array,
    bounds: WorldRect,
    cellSize: number,
  ) {
    this.xs = xs;
    this.ys = ys;
    this.count = xs.length;
    this.cellSize = Math.max(cellSize, 1e-3);
    this.originX = bounds.minX;
    this.originY = bounds.minY;
    const width = Math.max(bounds.maxX - bounds.minX, this.cellSize);
    const height = Math.max(bounds.maxY - bounds.minY, this.cellSize);
    this.cols = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));

    // Two-pass: count then fill — avoids per-cell JS arrays growing mid-insert.
    const cellCount = this.cols * this.rows;
    const counts = new Uint32Array(cellCount);
    for (let i = 0; i < this.count; i++) {
      const c = this.cellIndex(xs[i], ys[i]);
      counts[c]++;
    }
    this.cells = new Array(cellCount);
    const cursors = new Uint32Array(cellCount);
    for (let c = 0; c < cellCount; c++) {
      this.cells[c] = new Uint32Array(counts[c]);
    }
    for (let i = 0; i < this.count; i++) {
      const c = this.cellIndex(xs[i], ys[i]);
      this.cells[c][cursors[c]++] = i;
    }
  }

  private clampCell(cx: number, cy: number): { cx: number; cy: number } {
    return {
      cx: cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx,
      cy: cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy,
    };
  }

  private cellIndex(x: number, y: number): number {
    const rawCx = Math.floor((x - this.originX) / this.cellSize);
    const rawCy = Math.floor((y - this.originY) / this.cellSize);
    const { cx, cy } = this.clampCell(rawCx, rawCy);
    return cy * this.cols + cx;
  }

  private cellRange(rect: WorldRect): { c0: number; c1: number; r0: number; r1: number } {
    const c0 = Math.floor((rect.minX - this.originX) / this.cellSize);
    const c1 = Math.floor((rect.maxX - this.originX) / this.cellSize);
    const r0 = Math.floor((rect.minY - this.originY) / this.cellSize);
    const r1 = Math.floor((rect.maxY - this.originY) / this.cellSize);
    return {
      c0: Math.max(0, c0),
      c1: Math.min(this.cols - 1, c1),
      r0: Math.max(0, r0),
      r1: Math.min(this.rows - 1, r1),
    };
  }

  /**
   * Collect seat indices whose positions fall inside `rect`.
   * Writes into `out` (cleared first) and returns the count — zero alloc on hot path.
   */
  queryRect(rect: WorldRect, out: Uint32Array): number {
    const { c0, c1, r0, r1 } = this.cellRange(rect);
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const bucket = this.cells[cy * this.cols + cx];
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          const x = this.xs[idx];
          const y = this.ys[idx];
          if (rectContainsPoint(rect, x, y)) {
            if (n < out.length) out[n] = idx;
            n++;
          }
        }
      }
    }
    return n;
  }

  /** Same as queryRect but allocates a dense result (convenience / tests). */
  queryRectIndices(rect: WorldRect): Uint32Array {
    // First pass count to size exactly — rare path vs frame culling.
    const tmp = new Uint32Array(Math.min(this.count, 65536));
    let n = this.queryRect(rect, tmp);
    if (n <= tmp.length) return tmp.subarray(0, n).slice();
    const big = new Uint32Array(n);
    this.queryRect(rect, big);
    return big;
  }

  /**
   * Nearest seat within `radius` world units. Returns index or -1.
   * Searches the cell ring covering the radius.
   */
  hitTest(x: number, y: number, radius: number): { index: number; dist: number } {
    const r2 = radius * radius;
    const pad = radius;
    const rect: WorldRect = {
      minX: x - pad,
      minY: y - pad,
      maxX: x + pad,
      maxY: y + pad,
    };
    const { c0, c1, r0, r1 } = this.cellRange(rect);
    let best = -1;
    let bestD = r2;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const bucket = this.cells[cy * this.cols + cx];
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          const dx = this.xs[idx] - x;
          const dy = this.ys[idx] - y;
          const d = dx * dx + dy * dy;
          if (d <= bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
    }
    return best < 0 ? { index: -1, dist: Infinity } : { index: best, dist: Math.sqrt(bestD) };
  }

  /** Point-in-polygon selection (lasso). Uses bbox prefilter then PIP. */
  queryLasso(poly: readonly WorldPoint[], out: Uint32Array): number {
    if (poly.length < 3) return 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const rect: WorldRect = { minX, minY, maxX, maxY };
    const { c0, c1, r0, r1 } = this.cellRange(rect);
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const bucket = this.cells[cy * this.cols + cx];
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          const sx = this.xs[idx];
          const sy = this.ys[idx];
          if (!rectContainsPoint(rect, sx, sy)) continue;
          if (pointInPolygon(sx, sy, poly)) {
            if (n < out.length) out[n] = idx;
            n++;
          }
        }
      }
    }
    return n;
  }

  /**
   * Viewport culling: write visible indices into `out`.
   * Identical to queryRect but named for call-site clarity in the render planner.
   */
  cull(viewport: WorldRect, out: Uint32Array): number {
    return this.queryRect(viewport, out);
  }

  /** True if rect overlaps the indexed domain (fast reject). */
  overlapsDomain(rect: WorldRect): boolean {
    const domain: WorldRect = {
      minX: this.originX,
      minY: this.originY,
      maxX: this.originX + this.cols * this.cellSize,
      maxY: this.originY + this.rows * this.cellSize,
    };
    return rectIntersects(domain, rect);
  }

  get seatCount(): number {
    return this.count;
  }

  get gridSize(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }
}

/** Estimate a good cell size from seat count and bounds. */
export function estimateCellSize(bounds: WorldRect, seatCount: number, hint?: number): number {
  if (hint && hint > 0) return hint;
  const area = Math.max((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY), 1);
  const density = Math.max(seatCount, 1) / area;
  // Aim for ~8–16 seats per cell on average.
  const perCell = 12;
  return Math.sqrt(perCell / density);
}
