/** SVG path helpers + status palette for 2D seat rendering */
export function seatCircle(x: number, y: number, r = 6): string {
  return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}

export const SEAT_STATUS_COLORS = {
  available: '#5b9fd4',
  held: '#d4a017',
  sold: '#3f3f46',
  selected: '#e11d48',
  dimmed: '#2a2a2e',
} as const;

/** Map price to heat color: low = cool blue, high = rose accent */
export function priceHeatColor(price: number, min: number, max: number): string {
  if (!Number.isFinite(price) || max <= min) return SEAT_STATUS_COLORS.available;
  const t = Math.min(1, Math.max(0, (price - min) / (max - min)));
  // cool #486581 → mid #a16207 → hot #e11d48
  const stops = [
    { t: 0, r: 72, g: 101, b: 129 },
    { t: 0.55, r: 161, g: 98, b: 7 },
    { t: 1, r: 225, g: 29, b: 72 },
  ];
  return lerpStops(t, stops);
}

/**
 * Map sightline score (0..1) to heat: poor = slate/rose, good = teal/emerald.
 * Higher score = better view.
 */
export function sightlineHeatColor(score: number): string {
  if (!Number.isFinite(score)) return SEAT_STATUS_COLORS.dimmed;
  const t = Math.min(1, Math.max(0, score));
  const stops = [
    { t: 0, r: 63, g: 63, b: 70 }, // blocked/poor
    { t: 0.28, r: 190, g: 70, b: 70 }, // restricted
    { t: 0.5, r: 180, g: 140, b: 50 }, // fair
    { t: 0.72, r: 56, g: 160, b: 120 }, // good
    { t: 1, r: 34, g: 197, b: 94 }, // premium
  ];
  return lerpStops(t, stops);
}

function lerpStops(
  t: number,
  stops: Array<{ t: number; r: number; g: number; b: number }>
): string {
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
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `rgb(${r},${g},${bl})`;
}

export type OfferLike = { id: string; zone: string; name?: string; basePrice: string | number };

export function resolveOfferForSection(
  offers: OfferLike[],
  sectionSlug: string,
  sectionName?: string
): OfferLike | undefined {
  if (!offers.length) return undefined;
  const byZone = new Map(offers.map((o) => [o.zone.toLowerCase(), o]));
  const slug = sectionSlug.toLowerCase();
  const name = sectionName?.toLowerCase();

  const exact =
    byZone.get(slug) ||
    (name ? byZone.get(name) : undefined) ||
    offers.find((o) => o.name?.toLowerCase() === name || o.name?.toLowerCase() === slug);

  if (exact) return exact;

  // Fuzzy: "lateral-izq" ↔ "Lateral Izq"
  const compact = (s: string) => s.replace(/[\s_-]+/g, '');
  const slugC = compact(slug);
  const nameC = name ? compact(name) : '';
  const fuzzy = offers.find((o) => {
    const z = compact(o.zone);
    const n = compact(o.name ?? '');
    return z === slugC || z === nameC || n === slugC || n === nameC;
  });
  if (fuzzy) return fuzzy;

  // Last resort only when a single offer exists (true GA event).
  return offers.length === 1 ? offers[0] : undefined;
}
