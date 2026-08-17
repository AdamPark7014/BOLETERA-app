import { mapToMeters } from '../geometry/snaps';
import type { Camera } from './camera';
import { niceStep } from './math';
import type { WorldRect } from './types';

export type GridSpec = {
  /** Minor grid step in world (map) units. */
  minorStep: number;
  /** Major grid step (typically 5× or 10× minor). */
  majorStep: number;
  /** Minor step in meters (for ruler labels). */
  minorMeters: number;
  majorMeters: number;
};

/**
 * Figma-style adaptive grid: choose a nice meter step so minor lines sit
 * ~40–80 CSS px apart regardless of zoom.
 */
export function computeGridSpec(camera: Camera, scale = 40): GridSpec {
  const targetPx = 56;
  const worldPerLine = targetPx / Math.max(camera.zoom, 1e-6);
  const metersPerLine = mapToMeters(worldPerLine, scale);
  const minorMeters = niceStep(metersPerLine);
  // Prefer major every 5 minors when minor is 1/2/5 pattern; else every 10.
  const majorMul = minorMeters / Math.pow(10, Math.floor(Math.log10(minorMeters))) === 2 ? 5 : 5;
  const majorMeters = minorMeters * majorMul;
  return {
    minorStep: minorMeters * scale,
    majorStep: majorMeters * scale,
    minorMeters,
    majorMeters,
  };
}

export type GridLine = { a: number; major: boolean };

/** Collect vertical (x=const) and horizontal (y=const) line positions in world units. */
export function collectGridLines(viewport: WorldRect, spec: GridSpec): {
  vertical: GridLine[];
  horizontal: GridLine[];
} {
  const vertical: GridLine[] = [];
  const horizontal: GridLine[] = [];
  const startX = Math.floor(viewport.minX / spec.minorStep) * spec.minorStep;
  const startY = Math.floor(viewport.minY / spec.minorStep) * spec.minorStep;
  for (let x = startX; x <= viewport.maxX + spec.minorStep * 0.5; x += spec.minorStep) {
    const major = Math.abs(x / spec.majorStep - Math.round(x / spec.majorStep)) < 1e-6;
    vertical.push({ a: x, major });
  }
  for (let y = startY; y <= viewport.maxY + spec.minorStep * 0.5; y += spec.minorStep) {
    const major = Math.abs(y / spec.majorStep - Math.round(y / spec.majorStep)) < 1e-6;
    horizontal.push({ a: y, major });
  }
  return { vertical, horizontal };
}

export function formatMeters(m: number): string {
  if (Math.abs(m) >= 100) return `${Math.round(m)} m`;
  if (Math.abs(m) >= 10) return `${m.toFixed(0)} m`;
  if (Math.abs(m) >= 1) return `${m.toFixed(1)} m`;
  return `${m.toFixed(2)} m`;
}
