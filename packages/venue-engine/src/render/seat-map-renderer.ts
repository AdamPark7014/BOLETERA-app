import type { SeatMapData } from '@boletera/shared';
import { Camera, detectReducedMotion } from './camera';
import { Canvas2DRenderer } from './canvas2d-renderer';
import { LayerStack } from './layers';
import { LodController } from './lod';
import { RenderScheduler } from './render-scheduler';
import {
  applySeatPatches,
  buildSceneBuffers,
  rebakeColors,
  type SceneBuffers,
} from './scene-buffers';
import { WebGlSeatRenderer, tryCreateWebGL2 } from './webgl-renderer';
import type {
  AnalysisOverlay,
  ColorMode,
  ColorModeContext,
  HitResult,
  InteractionOverlay,
  LayerId,
  RenderStats,
  SceneOptions,
  ScreenPoint,
  SeatMapRendererOptions,
  SeatPatch,
  WorldPoint,
  WorldRect,
} from './types';

/**
 * Headless (non-React) seat-map render engine.
 *
 * Lifecycle expected by the React editor shell:
 * ```ts
 * const r = new SeatMapRenderer();
 * r.mount(canvas);
 * r.setScene(map);
 * // …hitTest / queryRect / updateSeats…
 * r.destroy(); // releases GPU buffers, listeners, RAF
 * ```
 */
export class SeatMapRenderer {
  readonly camera: Camera;
  readonly layers = new LayerStack();
  readonly lod = new LodController();
  readonly scheduler = new RenderScheduler();

  private canvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private webgl: WebGlSeatRenderer | null = null;
  private canvas2d: Canvas2DRenderer | null = null;
  private scene: SceneBuffers | null = null;
  private backend: 'webgl2' | 'canvas2d' = 'canvas2d';
  private background: string;
  private forceCanvas2d: boolean;
  private analysis: AnalysisOverlay[] = [];
  private interaction: InteractionOverlay | null = null;
  private visibleBuf = new Uint32Array(0);
  private queryBuf = new Uint32Array(0);
  private resizeObserver: ResizeObserver | null = null;
  private mounted = false;
  private opts: SeatMapRendererOptions;

  constructor(opts: SeatMapRendererOptions = {}) {
    this.opts = opts;
    this.background = opts.background ?? '#111827';
    this.forceCanvas2d = opts.forceCanvas2d ?? false;
    this.camera = new Camera({
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      reducedMotion: detectReducedMotion(opts.reducedMotion),
    });
    this.camera.setOnChange(() => this.scheduler.markDirty());
  }

  /**
   * Attach to a canvas. Creates an absolute-positioned overlay sibling for
   * vector layers when WebGL2 is used for seats.
   */
  mount(canvas: HTMLCanvasElement): void {
    if (this.mounted) this.destroy();
    this.canvas = canvas;
    this.ensureSizeFromCanvas();

    const gl = !this.forceCanvas2d ? tryCreateWebGL2(canvas) : null;
    if (gl) {
      this.backend = 'webgl2';
      this.webgl = new WebGlSeatRenderer(gl);
      this.overlayCanvas = this.createOverlay(canvas);
      const octx = this.overlayCanvas.getContext('2d');
      if (!octx) throw new Error('2D overlay context unavailable');
      this.canvas2d = new Canvas2DRenderer(octx);
    } else {
      this.backend = 'canvas2d';
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas2D context unavailable');
      this.canvas2d = new Canvas2DRenderer(ctx);
    }

    this.scheduler.backend = this.backend;
    this.scheduler.start((frame) => this.paint(frame.time, frame.budgetMs));

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.ensureSizeFromCanvas();
        this.scheduler.markDirty();
      });
      this.resizeObserver.observe(canvas);
    }

    this.mounted = true;
    this.scheduler.markDirty();
  }

  /** Replace the entire scene graph (rebuilds SoA buffers + spatial index). */
  setScene(data: SeatMapData, options: SceneOptions = {}): void {
    this.scene = buildSceneBuffers(data, {
      colorMode: options.colorMode,
      colorContext: options.colorContext,
      seatRadius: options.seatRadius ?? this.opts.seatRadius,
      cellSize: this.opts.cellSize,
    });
    this.scheduler.indexBuildMs = this.scene.indexBuildMs;
    this.scheduler.seatsTotal = this.scene.seatCount;
    this.visibleBuf = new Uint32Array(this.scene.seatCount);
    this.queryBuf = new Uint32Array(this.scene.seatCount);
    if (this.webgl) this.webgl.uploadScene(this.scene);
    this.camera.fitToBounds(this.scene.bounds, 48, false);
    this.lod.update(this.camera, this.scene.seatRadius);
    this.scheduler.markDirty();
  }

  /** Incremental seat mutations (positions rebuild the index only when needed). */
  updateSeats(patch: readonly SeatPatch[]): void {
    if (!this.scene || patch.length === 0) return;
    applySeatPatches(this.scene, patch);
    this.scheduler.indexBuildMs = this.scene.indexBuildMs;
    if (this.webgl) this.webgl.uploadScene(this.scene);
    this.scheduler.markDirty();
  }

  setColorMode(mode: ColorMode, context: ColorModeContext = {}): void {
    if (!this.scene) return;
    this.scene.colorMode = mode;
    this.scene.colorContext = { ...this.scene.colorContext, ...context };
    rebakeColors(this.scene);
    if (this.webgl) this.webgl.uploadScene(this.scene);
    this.scheduler.markDirty();
  }

  setLayerVisibility(layer: LayerId, visible: boolean): void {
    this.layers.setVisibility(layer, visible);
    this.scheduler.markDirty();
  }

  setLayerLocked(layer: LayerId, locked: boolean): void {
    this.layers.setLocked(layer, locked);
  }

  setAnalysisOverlays(overlays: AnalysisOverlay[]): void {
    this.analysis = overlays;
    this.scheduler.markDirty();
  }

  setInteractionOverlay(overlay: InteractionOverlay | null): void {
    this.interaction = overlay;
    this.scheduler.markDirty();
  }

  /** Hit-test in CSS-pixel canvas coordinates (default) or world space. */
  hitTest(
    point: ScreenPoint | WorldPoint,
    space: 'screen' | 'world' = 'screen',
  ): HitResult | null {
    if (!this.scene) return null;
    const t0 = performance.now();
    const world = space === 'world' ? (point as WorldPoint) : this.camera.screenToWorld(point as ScreenPoint);
    const radius = this.scene.seatRadius * 1.25;
    const hit = this.scene.index.hitTest(world.x, world.y, radius);
    this.scheduler.lastHitTestMs = performance.now() - t0;
    if (hit.index < 0) return null;
    const screen = this.camera.worldToScreen({
      x: this.scene.xs[hit.index],
      y: this.scene.ys[hit.index],
    });
    return {
      seatId: this.scene.seatIds[hit.index],
      index: hit.index,
      world: { x: this.scene.xs[hit.index], y: this.scene.ys[hit.index] },
      screen,
      distance: hit.dist,
    };
  }

  /** Marquee / rectangle selection in world space. */
  queryRect(rect: WorldRect): string[] {
    if (!this.scene) return [];
    const n = this.scene.index.queryRect(rect, this.queryBuf);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(this.scene.seatIds[this.queryBuf[i]]);
    return ids;
  }

  /** Lasso selection (world-space polygon). */
  queryLasso(points: readonly WorldPoint[]): string[] {
    if (!this.scene) return [];
    const n = this.scene.index.queryLasso(points, this.queryBuf);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(this.scene.seatIds[this.queryBuf[i]]);
    return ids;
  }

  /** Viewport culling — returns dense seat indices currently visible. */
  cullVisible(): Uint32Array {
    if (!this.scene) return new Uint32Array(0);
    const t0 = performance.now();
    const vp = this.camera.visibleWorldRect(this.scene.seatRadius);
    const n = this.scene.index.cull(vp, this.visibleBuf);
    this.scheduler.lastCullMs = performance.now() - t0;
    this.scheduler.seatsDrawn = n;
    this.scheduler.seatsCulled = this.scene.seatCount - n;
    return this.visibleBuf.subarray(0, n);
  }

  getStats(): RenderStats {
    return this.scheduler.getStats();
  }

  getScene(): SceneBuffers | null {
    return this.scene;
  }

  getBackend(): 'webgl2' | 'canvas2d' {
    return this.backend;
  }

  /** Force a redraw on the next animation frame. */
  requestRedraw(): void {
    this.scheduler.markDirty();
  }

  /**
   * Tear down GPU resources, overlay DOM, RAF, and observers.
   * Safe to call multiple times. Required before React unmount.
   */
  destroy(): void {
    this.scheduler.destroy();
    this.camera.destroy();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.webgl) {
      this.webgl.destroy();
      this.webgl = null;
    }
    if (this.overlayCanvas?.parentElement) {
      this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
    }
    this.overlayCanvas = null;
    this.canvas2d = null;
    this.canvas = null;
    this.scene = null;
    this.mounted = false;
    this.visibleBuf = new Uint32Array(0);
    this.queryBuf = new Uint32Array(0);
  }

  private ensureSizeFromCanvas(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    const w = rect.width || this.canvas.clientWidth || this.canvas.width || 1;
    const h = rect.height || this.canvas.clientHeight || this.canvas.height || 1;
    this.camera.setViewport(w, h, dpr);
    const buf = this.camera.bufferSize();
    if (this.backend === 'webgl2') {
      this.canvas.width = buf.width;
      this.canvas.height = buf.height;
    }
    if (this.overlayCanvas) {
      this.overlayCanvas.style.width = `${w}px`;
      this.overlayCanvas.style.height = `${h}px`;
      this.overlayCanvas.width = buf.width;
      this.overlayCanvas.height = buf.height;
    }
  }

  private createOverlay(base: HTMLCanvasElement): HTMLCanvasElement {
    const overlay = document.createElement('canvas');
    overlay.className = 'boletera-seatmap-overlay';
    const parent = base.parentElement;
    const style = overlay.style;
    style.position = 'absolute';
    style.left = '0';
    style.top = '0';
    style.width = '100%';
    style.height = '100%';
    style.pointerEvents = 'none';
    if (parent) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(overlay);
    }
    return overlay;
  }

  private paint(time: number, budgetMs: number): void {
    void time;
    if (!this.canvas2d || !this.scene) return;

    const lodChanged = this.lod.update(this.camera, this.scene.seatRadius);
    if (lodChanged) this.scheduler.markDirty();
    this.scheduler.lod = this.lod.current;
    this.scheduler.backend = this.backend;
    this.scheduler.seatsTotal = this.scene.seatCount;

    const t0 = performance.now();
    const vp = this.camera.visibleWorldRect(this.scene.seatRadius);
    const visibleCount =
      this.lod.current === 'seats'
        ? this.scene.index.cull(vp, this.visibleBuf)
        : 0;
    this.scheduler.lastCullMs = performance.now() - t0;
    this.scheduler.seatsDrawn =
      this.lod.current === 'seats' ? visibleCount : this.scene.sectionAggs.length;
    this.scheduler.seatsCulled = this.scene.seatCount - visibleCount;

    const frame = {
      camera: this.camera,
      scene: this.scene,
      layers: this.layers,
      lod: this.lod.current,
      lodController: this.lod,
      visible: this.visibleBuf,
      visibleCount,
      analysis: this.analysis,
      interaction: this.interaction,
      background: this.background,
      frameStart: performance.now(),
      budgetMs,
    };

    let drawCalls = 0;
    if (this.backend === 'webgl2' && this.webgl) {
      if (this.layers.isVisible('seats') && this.lod.current === 'seats') {
        this.webgl.drawCulled(
          this.scene,
          this.camera,
          this.visibleBuf,
          visibleCount,
          this.background,
        );
        drawCalls += 1;
      } else {
        // Clear WebGL when showing aggregates only.
        this.webgl.drawCulled(this.scene, this.camera, this.visibleBuf, 0, this.background);
      }
      drawCalls += this.canvas2d.drawOverlay(frame);
    } else {
      drawCalls += this.canvas2d.drawAll(frame, true);
    }
    this.scheduler.drawCalls = drawCalls;
  }
}
