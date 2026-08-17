import {
  SEAT_STATUS_COLORS,
  resolveOfferForSection,
  type OfferLike,
} from '../seatmap-canvas';
import type { ColorMode, ColorModeContext, SeatRenderStatus } from './types';
import { lookupRecord } from './types';

type RgbStop = { t: number; r: number; g: number; b: number };

const PRICE_STOPS: RgbStop[] = [
  { t: 0, r: 72, g: 101, b: 129 },
  { t: 0.55, r: 161, g: 98, b: 7 },
  { t: 1, r: 225, g: 29, b: 72 },
];

const SIGHT_STOPS: RgbStop[] = [
  { t: 0, r: 63, g: 63, b: 70 },
  { t: 0.28, r: 190, g: 70, b: 70 },
  { t: 0.5, r: 180, g: 140, b: 50 },
  { t: 0.72, r: 56, g: 160, b: 120 },
  { t: 1, r: 34, g: 197, b: 94 },
];

const TIER_PALETTE = [
  '#5b9fd4',
  '#d4a017',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#64748b',
];

function lerpStopsInto(
  t: number,
  stops: readonly RgbStop[],
  out: Float32Array,
  offset: number,
  alpha = 1,
): void {
  let a = stops[0];
  let b = stops[1] ?? stops[0];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const u = (t - a.t) / Math.max(b.t - a.t, 0.0001);
  out[offset] = (a.r + (b.r - a.r) * u) / 255;
  out[offset + 1] = (a.g + (b.g - a.g) * u) / 255;
  out[offset + 2] = (a.b + (b.b - a.b) * u) / 255;
  out[offset + 3] = alpha;
}

/** GPU-friendly twin of priceHeatColor — no CSS string alloc. */
export function priceHeatRgba(
  price: number,
  min: number,
  max: number,
  out: Float32Array,
  offset: number,
): void {
  if (!Number.isFinite(price) || max <= min) {
    parseCssColor(SEAT_STATUS_COLORS.available, out, offset);
    return;
  }
  const t = Math.min(1, Math.max(0, (price - min) / (max - min)));
  lerpStopsInto(t, PRICE_STOPS, out, offset);
}

/** GPU-friendly twin of sightlineHeatColor. */
export function sightlineHeatRgba(score: number, out: Float32Array, offset: number): void {
  if (!Number.isFinite(score)) {
    parseCssColor(SEAT_STATUS_COLORS.dimmed, out, offset);
    return;
  }
  const t = Math.min(1, Math.max(0, score));
  lerpStopsInto(t, SIGHT_STOPS, out, offset);
}

export function parseCssColor(css: string, out: Float32Array, offset: number, alpha = 1): void {
  const s = css.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      out[offset] = parseInt(hex[0] + hex[0], 16) / 255;
      out[offset + 1] = parseInt(hex[1] + hex[1], 16) / 255;
      out[offset + 2] = parseInt(hex[2] + hex[2], 16) / 255;
      out[offset + 3] = alpha;
      return;
    }
    if (hex.length >= 6) {
      out[offset] = parseInt(hex.slice(0, 2), 16) / 255;
      out[offset + 1] = parseInt(hex.slice(2, 4), 16) / 255;
      out[offset + 2] = parseInt(hex.slice(4, 6), 16) / 255;
      out[offset + 3] = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : alpha;
      return;
    }
  }
  const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
    s,
  );
  if (m) {
    out[offset] = Number(m[1]) / 255;
    out[offset + 1] = Number(m[2]) / 255;
    out[offset + 2] = Number(m[3]) / 255;
    out[offset + 3] = m[4] !== undefined ? Number(m[4]) : alpha;
    return;
  }
  out[offset] = 0.4;
  out[offset + 1] = 0.4;
  out[offset + 2] = 0.45;
  out[offset + 3] = alpha;
}

export function statusColorRgba(status: SeatRenderStatus, out: Float32Array, offset: number): void {
  parseCssColor(SEAT_STATUS_COLORS[status] ?? SEAT_STATUS_COLORS.available, out, offset);
}

function toSelectedSet(
  selected?: ColorModeContext['selectedIds'],
): ReadonlySet<string> | null {
  if (!selected) return null;
  if (selected instanceof Set) return selected;
  return new Set(selected);
}

export type ColorBakeInput = {
  mode: ColorMode;
  context: ColorModeContext;
  seatIds: string[];
  sectionSlugs: string[];
  sectionNames: string[];
  sectionColors: string[];
  seatSectionIndex: Uint32Array;
  tiers: (string | undefined)[];
  /** Optional authored per-seat color override (zone default). */
  authoredColors?: (string | undefined)[];
};

/**
 * Bake RGBA colors for every seat into a packed Float32Array (N×4).
 * Hot path for setColorMode / setScene — avoids per-seat object colors.
 */
export function bakeSeatColors(input: ColorBakeInput, out: Float32Array): { minPrice: number; maxPrice: number } {
  const n = input.seatIds.length;
  const selected = toSelectedSet(input.context.selectedIds);
  let minPrice = input.context.priceRange?.min ?? Infinity;
  let maxPrice = input.context.priceRange?.max ?? -Infinity;

  if (input.mode === 'price' && input.context.priceRange === undefined) {
    for (let i = 0; i < n; i++) {
      const p = resolvePrice(input, i);
      if (p !== undefined && Number.isFinite(p)) {
        if (p < minPrice) minPrice = p;
        if (p > maxPrice) maxPrice = p;
      }
    }
    if (!Number.isFinite(minPrice)) {
      minPrice = 0;
      maxPrice = 1;
    }
  }

  const tierIndex = new Map<string, number>();
  let tierCursor = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const id = input.seatIds[i];
    if (selected?.has(id)) {
      statusColorRgba('selected', out, o);
      continue;
    }

    switch (input.mode) {
      case 'zone': {
        const authored = input.authoredColors?.[i];
        const si = input.seatSectionIndex[i];
        parseCssColor(authored ?? input.sectionColors[si] ?? '#5b9fd4', out, o);
        break;
      }
      case 'tier': {
        const tier = input.tiers[i] ?? 'default';
        let ti = tierIndex.get(tier);
        if (ti === undefined) {
          ti = tierCursor++;
          tierIndex.set(tier, ti);
        }
        parseCssColor(TIER_PALETTE[ti % TIER_PALETTE.length], out, o);
        break;
      }
      case 'price': {
        const p = resolvePrice(input, i) ?? minPrice;
        priceHeatRgba(p, minPrice, maxPrice, out, o);
        break;
      }
      case 'status': {
        const st =
          lookupRecord(input.context.statusBySeatId, id) ?? ('available' as SeatRenderStatus);
        statusColorRgba(st, out, o);
        break;
      }
      case 'sightline': {
        const score = lookupRecord(input.context.sightlineBySeatId, id) ?? 0.5;
        sightlineHeatRgba(score, out, o);
        break;
      }
      default: {
        parseCssColor('#5b9fd4', out, o);
      }
    }
  }

  return { minPrice, maxPrice };
}

function resolvePrice(input: ColorBakeInput, i: number): number | undefined {
  const id = input.seatIds[i];
  const direct = lookupRecord(input.context.priceBySeatId, id);
  if (direct !== undefined) return direct;
  const offers = input.context.offers as OfferLike[] | undefined;
  if (!offers?.length) return undefined;
  const si = input.seatSectionIndex[i];
  const offer = resolveOfferForSection(offers, input.sectionSlugs[si] ?? '', input.sectionNames[si]);
  if (!offer) return undefined;
  const v = typeof offer.basePrice === 'number' ? offer.basePrice : Number(offer.basePrice);
  return Number.isFinite(v) ? v : undefined;
}

export function rgbaToCss(colors: Float32Array, offset: number): string {
  const r = Math.round(colors[offset] * 255);
  const g = Math.round(colors[offset + 1] * 255);
  const b = Math.round(colors[offset + 2] * 255);
  const a = colors[offset + 3];
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}
