/**
 * @boletera/venue-engine render engine
 *
 * GPU-first seat map renderer for enterprise venue editors.
 * Consumable from React without leaking RAF / WebGL resources —
 * always call {@link SeatMapRenderer.destroy} on unmount.
 *
 * @packageDocumentation
 */

export { Camera, detectReducedMotion } from './camera';
export type { CameraOptions } from './camera';

export { LayerStack, DEFAULT_LAYER_ORDER } from './layers';

export { SpatialIndex, estimateCellSize } from './spatial-index';

export { LodController, buildLodAggregates } from './lod';
export type { SectionAggregate, RowAggregate } from './lod';

export {
  bakeSeatColors,
  priceHeatRgba,
  sightlineHeatRgba,
  parseCssColor,
  statusColorRgba,
  rgbaToCss,
} from './colors';
export type { ColorBakeInput } from './colors';

export {
  buildSceneBuffers,
  applySeatPatches,
  rebakeColors,
  generateSyntheticVenue,
} from './scene-buffers';
export type { SceneBuffers } from './scene-buffers';

export { computeGridSpec, collectGridLines, formatMeters } from './grid';
export type { GridSpec, GridLine } from './grid';

export { RenderScheduler } from './render-scheduler';
export type { FrameDrawFn } from './render-scheduler';

export { WebGlSeatRenderer, tryCreateWebGL2 } from './webgl-renderer';
export { Canvas2DRenderer } from './canvas2d-renderer';
export type { OverlayDrawContext } from './canvas2d-renderer';

export { SeatMapRenderer } from './seat-map-renderer';

export { clamp, lerp, niceStep, rectIntersects, rectContainsPoint, pointInPolygon, expandRect } from './math';

export type {
  WorldPoint,
  ScreenPoint,
  WorldRect,
  ColorMode,
  SeatRenderStatus,
  LayerId,
  LayerState,
  LodLevel,
  HitResult,
  SeatPatch,
  ColorModeContext,
  SceneOptions,
  AnalysisOverlay,
  InteractionOverlay,
  RenderStats,
  CameraState,
  SeatMapRendererOptions,
  SceneSnapshot,
} from './types';

export { lookupRecord } from './types';
