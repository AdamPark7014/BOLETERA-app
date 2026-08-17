import type { SeatMapBounds } from '@boletera/shared';
import { clamp, lerp } from './math';
import type { CameraState, ScreenPoint, WorldPoint, WorldRect } from './types';

const DEFAULT_MIN_ZOOM = 0.01;
const DEFAULT_MAX_ZOOM = 200;

export type CameraOptions = {
  minZoom?: number;
  maxZoom?: number;
  /** When true, skip inertia / animated zoom (a11y). */
  reducedMotion?: boolean;
};

/**
 * Orthographic 2D camera: world → CSS pixels.
 *
 * screen = (world - center) * zoom + viewport/2
 *
 * Zoom is cursor-anchored: the world point under the cursor stays fixed
 * while zoom changes, matching Figma / CAD editors.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  width = 1;
  height = 1;
  dpr = 1;

  readonly minZoom: number;
  readonly maxZoom: number;

  private reducedMotion: boolean;
  private animRaf = 0;
  private animFrom: CameraState | null = null;
  private animTo: CameraState | null = null;
  private animStart = 0;
  private animDuration = 0;
  private onChange: (() => void) | null = null;

  /** Pan velocity in world units / ms (for inertia). */
  private vx = 0;
  private vy = 0;
  private inertiaRaf = 0;
  private lastInertiaTs = 0;

  constructor(opts: CameraOptions = {}) {
    this.minZoom = opts.minZoom ?? DEFAULT_MIN_ZOOM;
    this.maxZoom = opts.maxZoom ?? DEFAULT_MAX_ZOOM;
    this.reducedMotion = opts.reducedMotion ?? false;
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
    if (v) this.stopInertia();
  }

  setOnChange(cb: (() => void) | null): void {
    this.onChange = cb;
  }

  setViewport(widthCss: number, heightCss: number, dpr = 1): void {
    this.width = Math.max(1, widthCss);
    this.height = Math.max(1, heightCss);
    this.dpr = Math.max(1, dpr);
    this.emit();
  }

  getState(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  setState(state: CameraState, animate = false, durationMs = 220): void {
    const next = {
      x: state.x,
      y: state.y,
      zoom: clamp(state.zoom, this.minZoom, this.maxZoom),
    };
    if (!animate || this.reducedMotion || durationMs <= 0) {
      this.cancelAnim();
      this.x = next.x;
      this.y = next.y;
      this.zoom = next.zoom;
      this.emit();
      return;
    }
    this.animFrom = this.getState();
    this.animTo = next;
    this.animStart = performance.now();
    this.animDuration = durationMs;
    this.tickAnim();
  }

  /** Pan by CSS-pixel delta (positive dx moves content right). */
  panByScreen(dxCss: number, dyCss: number, withVelocity = false): void {
    this.cancelAnim();
    const wx = dxCss / this.zoom;
    const wy = dyCss / this.zoom;
    this.x -= wx;
    this.y -= wy;
    if (withVelocity) {
      // Approximate instantaneous velocity; caller should call settleInertia after gesture.
      this.vx = -wx;
      this.vy = -wy;
    }
    this.emit();
  }

  /**
   * Zoom centered on a screen point (CSS pixels relative to canvas).
   * World point under cursor remains stationary.
   */
  zoomAtScreen(screen: ScreenPoint, factor: number, animate = false): void {
    const nextZoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    if (nextZoom === this.zoom) return;
    const world = this.screenToWorld(screen);
    if (!animate || this.reducedMotion) {
      this.cancelAnim();
      this.zoom = nextZoom;
      const after = this.worldToScreen(world);
      this.x += (after.x - screen.x) / this.zoom;
      this.y += (after.y - screen.y) / this.zoom;
      this.emit();
      return;
    }
    const target: CameraState = { x: this.x, y: this.y, zoom: nextZoom };
    // Precompute center so world under cursor stays put at end state.
    const tmpZoom = this.zoom;
    this.zoom = nextZoom;
    const after = this.worldToScreen(world);
    target.x = this.x + (after.x - screen.x) / this.zoom;
    target.y = this.y + (after.y - screen.y) / this.zoom;
    this.zoom = tmpZoom;
    this.setState(target, true, 140);
  }

  /** Fit world bounds into the viewport with padding (CSS px). */
  fitToBounds(bounds: SeatMapBounds | WorldRect, paddingCss = 48, animate = true): void {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const availW = Math.max(this.width - paddingCss * 2, 1);
    const availH = Math.max(this.height - paddingCss * 2, 1);
    const zoom = clamp(Math.min(availW / w, availH / h), this.minZoom, this.maxZoom);
    this.setState(
      {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
        zoom,
      },
      animate,
      280,
    );
  }

  worldToScreen(p: WorldPoint): ScreenPoint {
    return {
      x: (p.x - this.x) * this.zoom + this.width / 2,
      y: (p.y - this.y) * this.zoom + this.height / 2,
    };
  }

  screenToWorld(p: ScreenPoint): WorldPoint {
    return {
      x: (p.x - this.width / 2) / this.zoom + this.x,
      y: (p.y - this.height / 2) / this.zoom + this.y,
    };
  }

  /** Visible world AABB, optionally expanded by seat radius for culling. */
  visibleWorldRect(padWorld = 0): WorldRect {
    const tl = this.screenToWorld({ x: 0, y: 0 });
    const br = this.screenToWorld({ x: this.width, y: this.height });
    return {
      minX: Math.min(tl.x, br.x) - padWorld,
      minY: Math.min(tl.y, br.y) - padWorld,
      maxX: Math.max(tl.x, br.x) + padWorld,
      maxY: Math.max(tl.y, br.y) + padWorld,
    };
  }

  /** Device-pixel size of the drawing buffer. */
  bufferSize(): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(this.width * this.dpr)),
      height: Math.max(1, Math.round(this.height * this.dpr)),
    };
  }

  /**
   * Start inertia after a pan gesture. `releaseVx/Vy` are world units per ms.
   * Decays exponentially; stops under a small epsilon.
   */
  settleInertia(releaseVx: number, releaseVy: number): void {
    if (this.reducedMotion) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.vx = releaseVx;
    this.vy = releaseVy;
    this.lastInertiaTs = performance.now();
    if (!this.inertiaRaf) {
      const step = (ts: number) => {
        const dt = Math.min(32, ts - this.lastInertiaTs);
        this.lastInertiaTs = ts;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        // Friction ≈ 0.92 per 16ms → frame-rate independent decay.
        const decay = Math.pow(0.92, dt / 16);
        this.vx *= decay;
        this.vy *= decay;
        this.emit();
        if (Math.hypot(this.vx, this.vy) < 1e-4) {
          this.vx = 0;
          this.vy = 0;
          this.inertiaRaf = 0;
          return;
        }
        this.inertiaRaf = requestAnimationFrame(step);
      };
      this.inertiaRaf = requestAnimationFrame(step);
    }
  }

  stopInertia(): void {
    if (this.inertiaRaf) {
      cancelAnimationFrame(this.inertiaRaf);
      this.inertiaRaf = 0;
    }
    this.vx = 0;
    this.vy = 0;
  }

  destroy(): void {
    this.cancelAnim();
    this.stopInertia();
    this.onChange = null;
  }

  private emit(): void {
    this.onChange?.();
  }

  private cancelAnim(): void {
    if (this.animRaf) {
      cancelAnimationFrame(this.animRaf);
      this.animRaf = 0;
    }
    this.animFrom = null;
    this.animTo = null;
  }

  private tickAnim(): void {
    const from = this.animFrom;
    const to = this.animTo;
    if (!from || !to) return;
    const t = clamp((performance.now() - this.animStart) / this.animDuration, 0, 1);
    // Smoothstep ease — imperceptible for short zooms, soft for fitToBounds.
    const e = t * t * (3 - 2 * t);
    this.x = lerp(from.x, to.x, e);
    this.y = lerp(from.y, to.y, e);
    this.zoom = lerp(from.zoom, to.zoom, e);
    this.emit();
    if (t < 1) {
      this.animRaf = requestAnimationFrame(() => this.tickAnim());
    } else {
      this.animRaf = 0;
      this.animFrom = null;
      this.animTo = null;
    }
  }
}

/** Detect prefers-reduced-motion when a window exists (SSR-safe). */
export function detectReducedMotion(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
