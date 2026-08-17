import type { LodLevel, RenderStats } from './types';

export type FrameDrawFn = (frame: {
  time: number;
  budgetMs: number;
}) => void;

/**
 * Dirty-flag RAF planner.
 *
 * Only schedules frames while `dirty` is set or an animation is in flight.
 * Exposes FPS / frame-time for the diagnostics HUD the React shell can show.
 */
export class RenderScheduler {
  private raf = 0;
  private dirty = true;
  private running = false;
  private draw: FrameDrawFn | null = null;
  private lastTs = 0;
  private frameTimes: number[] = [];
  private dirtyFrames = 0;
  private skippedFrames = 0;
  /** Soft per-frame budget — draw functions should early-out labels when exceeded. */
  budgetMs = 12;

  // Mutable stats filled each drawn frame.
  seatsTotal = 0;
  seatsDrawn = 0;
  seatsCulled = 0;
  drawCalls = 0;
  lod: LodLevel = 'seats';
  backend: RenderStats['backend'] = 'canvas2d';
  indexBuildMs = 0;
  lastCullMs = 0;
  lastHitTestMs = 0;

  markDirty(): void {
    this.dirty = true;
    if (this.running && !this.raf) this.schedule();
  }

  start(draw: FrameDrawFn): void {
    this.draw = draw;
    this.running = true;
    this.dirty = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.draw = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  getStats(): RenderStats {
    const avg =
      this.frameTimes.length > 0
        ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
        : 0;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      frameTimeMs: avg,
      drawCalls: this.drawCalls,
      seatsTotal: this.seatsTotal,
      seatsDrawn: this.seatsDrawn,
      seatsCulled: this.seatsCulled,
      lod: this.lod,
      backend: this.backend,
      indexBuildMs: this.indexBuildMs,
      lastCullMs: this.lastCullMs,
      lastHitTestMs: this.lastHitTestMs,
      dirtyFrames: this.dirtyFrames,
      skippedFrames: this.skippedFrames,
    };
  }

  destroy(): void {
    this.stop();
    this.frameTimes = [];
  }

  private schedule(): void {
    if (this.raf || !this.running) return;
    this.raf = requestAnimationFrame((ts) => this.onFrame(ts));
  }

  private onFrame(ts: number): void {
    this.raf = 0;
    if (!this.running || !this.draw) return;

    if (!this.dirty) {
      this.skippedFrames++;
      // Stay idle — next markDirty() will reschedule.
      return;
    }

    this.dirty = false;
    this.dirtyFrames++;
    const t0 = ts;
    if (this.lastTs > 0) {
      const dt = ts - this.lastTs;
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    this.lastTs = ts;

    this.draw({ time: ts, budgetMs: this.budgetMs });

    const elapsed = performance.now() - t0;
    // If the draw itself marked dirty (camera inertia), keep pumping.
    if (this.dirty) this.schedule();

    // Record draw cost into rolling window when rAF dt is unavailable (first frame).
    if (this.frameTimes.length === 0) this.frameTimes.push(elapsed);
  }
}
