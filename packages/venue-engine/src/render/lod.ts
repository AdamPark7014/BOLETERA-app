import type { Camera } from './camera';
import type { LodLevel } from './types';

/**
 * LOD thresholds in world-units-per-CSS-pixel terms (i.e. 1/zoom).
 *
 * Measured empirically for ~0.5m seat pitch at scale 40 (≈20 map units):
 * - seats when a seat spans ≥ ~4 CSS px
 * - rows when a row pitch spans ≥ ~3 CSS px
 * - otherwise section aggregates / heat
 *
 * Hysteresis prevents flicker when zoom oscillates around a boundary.
 */
const SEAT_ENTER = 4.2; // seatRadius * zoom
const SEAT_EXIT = 3.4;
const ROW_ENTER = 1.6;
const ROW_EXIT = 1.1;

export class LodController {
  private level: LodLevel = 'seats';

  get current(): LodLevel {
    return this.level;
  }

  /**
   * Update LOD from camera. `seatRadius` is world units.
   * Returns true when the level changed (caller should mark dirty).
   */
  update(camera: Camera, seatRadius: number): boolean {
    const seatPx = seatRadius * camera.zoom;
    const prev = this.level;
    if (this.level === 'seats') {
      if (seatPx < SEAT_EXIT) this.level = seatPx < ROW_EXIT ? 'sections' : 'rows';
    } else if (this.level === 'rows') {
      if (seatPx >= SEAT_ENTER) this.level = 'seats';
      else if (seatPx < ROW_EXIT) this.level = 'sections';
    } else {
      if (seatPx >= SEAT_ENTER) this.level = 'seats';
      else if (seatPx >= ROW_ENTER) this.level = 'rows';
    }
    return this.level !== prev;
  }

  /** Show per-seat labels only when they won't collide heavily. */
  showLabels(camera: Camera, seatRadius: number): boolean {
    return this.level === 'seats' && seatRadius * camera.zoom >= 10;
  }
}

export type SectionAggregate = {
  sectionId: string;
  name: string;
  color: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  seatCount: number;
  /** Mean heat value 0..1 when color mode provides it. */
  heat: number;
};

export type RowAggregate = {
  key: string;
  sectionId: string;
  row: string;
  color: string;
  /** Sampled polyline along the row (endpoints + mid). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  seatCount: number;
};

/**
 * Build cheap aggregates for far/mid LOD. Called once per setScene —
 * not per frame — so object allocation here is acceptable.
 */
export function buildLodAggregates(
  sectionIds: string[],
  sectionNames: string[],
  sectionColors: string[],
  rows: (string | undefined)[],
  xs: Float32Array,
  ys: Float32Array,
  heats: Float32Array,
  seatSectionIndex: Uint32Array,
): { sections: SectionAggregate[]; rows: RowAggregate[] } {
  const secMap = new Map<string, SectionAggregate>();
  const rowMap = new Map<string, { agg: RowAggregate; sumX: number; sumY: number; n: number }>();

  for (let i = 0; i < xs.length; i++) {
    const si = seatSectionIndex[i];
    const sectionId = sectionIds[si] ?? `s${si}`;
    const name = sectionNames[si] ?? sectionId;
    const color = sectionColors[si] ?? '#888';
    const x = xs[i];
    const y = ys[i];
    const heat = heats[i];

    let sec = secMap.get(sectionId);
    if (!sec) {
      sec = {
        sectionId,
        name,
        color,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        seatCount: 0,
        heat: 0,
      };
      secMap.set(sectionId, sec);
    }
    if (x < sec.minX) sec.minX = x;
    if (y < sec.minY) sec.minY = y;
    if (x > sec.maxX) sec.maxX = x;
    if (y > sec.maxY) sec.maxY = y;
    sec.seatCount++;
    sec.heat += heat;

    const rowLabel = rows[i] ?? '';
    const key = `${sectionId}::${rowLabel}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        agg: {
          key,
          sectionId,
          row: rowLabel,
          color,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          seatCount: 0,
        },
        sumX: 0,
        sumY: 0,
        n: 0,
      };
      rowMap.set(key, row);
    }
    // Expand endpoints by x (rows are typically horizontal-ish); good enough for mid LOD.
    if (x < row.agg.x0) {
      row.agg.x0 = x;
      row.agg.y0 = y;
    }
    if (x > row.agg.x1) {
      row.agg.x1 = x;
      row.agg.y1 = y;
    }
    row.sumX += x;
    row.sumY += y;
    row.n++;
    row.agg.seatCount++;
  }

  const sections = Array.from(secMap.values());
  for (const s of sections) {
    s.heat = s.seatCount > 0 ? s.heat / s.seatCount : 0;
  }

  const rowAggs: RowAggregate[] = [];
  for (const { agg } of rowMap.values()) {
    rowAggs.push(agg);
  }
  return { sections, rows: rowAggs };
}
