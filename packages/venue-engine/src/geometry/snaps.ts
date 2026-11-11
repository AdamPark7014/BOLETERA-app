/** Snap a scalar to a pitch grid. */
export function snapValue(value: number, pitch: number): number {
  if (!pitch || pitch <= 0) return value;
  return Math.round(value / pitch) * pitch;
}

export function snapPoint(
  point: { x: number; y: number },
  pitch: number
): { x: number; y: number } {
  return { x: snapValue(point.x, pitch), y: snapValue(point.y, pitch) };
}

/** Convert meters → map units using venue scale (map units per meter). */
export function metersToMap(meters: number, scale = 40): number {
  return meters * scale;
}

/** Convert map units → meters. */
export function mapToMeters(mapUnits: number, scale = 40): number {
  return scale > 0 ? mapUnits / scale : mapUnits;
}

/** Suggested seat pitch in map units for ~0.5–0.55 m centers. */
export function defaultSeatPitchMap(scale = 40): number {
  return Math.round(metersToMap(0.52, scale));
}

export function defaultRowPitchMap(scale = 40): number {
  return Math.round(metersToMap(0.9, scale));
}
