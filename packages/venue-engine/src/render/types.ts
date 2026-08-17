import type { SeatMapBounds, SeatMapData, SeatVisibility } from '@boletera/shared';
import type { OfferLike } from '../seatmap-canvas';

/** World-space point in map units (same as SeatMapSeat.x/y). */
export type WorldPoint = { x: number; y: number };

/** CSS-pixel point relative to the canvas element (not device pixels). */
export type ScreenPoint = { x: number; y: number };

export type WorldRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ColorMode = 'zone' | 'tier' | 'price' | 'status' | 'sightline';

/**
 * Seat status for the `status` color mode.
 * Kept as string literals so React can pass inventory snapshots without coupling.
 */
export type SeatRenderStatus = 'available' | 'held' | 'sold' | 'selected' | 'dimmed';

export type LayerId =
  | 'background'
  | 'sections'
  | 'rows'
  | 'seats'
  | 'furniture'
  | 'stage'
  | 'analysis'
  | 'guides'
  | 'grid'
  | 'interaction';

export type LayerState = {
  id: LayerId;
  /** Painter's algorithm order (low → drawn first). */
  zIndex: number;
  visible: boolean;
  locked: boolean;
};

export type LodLevel = 'sections' | 'rows' | 'seats';

export type HitResult = {
  seatId: string;
  index: number;
  world: WorldPoint;
  screen: ScreenPoint;
  distance: number;
};

export type SeatPatch = {
  id: string;
  x?: number;
  y?: number;
  color?: string;
  status?: SeatRenderStatus;
  price?: number;
  sightlineScore?: number;
  scale?: number;
  selected?: boolean;
  visibility?: SeatVisibility;
  label?: string;
  row?: string;
  tier?: string;
};

export type ColorModeContext = {
  /** Inventory / hold map keyed by seat id. */
  statusBySeatId?: ReadonlyMap<string, SeatRenderStatus> | Readonly<Record<string, SeatRenderStatus>>;
  /** Absolute price per seat (or per-section fallback via offers). */
  priceBySeatId?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** Sightline quality 0..1 from calculateSightlines. */
  sightlineBySeatId?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** Zone offers used when priceBySeatId is sparse. */
  offers?: readonly OfferLike[];
  selectedIds?: ReadonlySet<string> | readonly string[];
  /** Explicit min/max for price heat; auto-derived when omitted. */
  priceRange?: { min: number; max: number };
};

export type SceneOptions = {
  colorMode?: ColorMode;
  colorContext?: ColorModeContext;
  /** Override seat radius in world units (default ~6 at typical map scale). */
  seatRadius?: number;
};

export type AnalysisOverlay = {
  kind: 'sightline' | 'egress' | 'circulation';
  /** Polyline segments in world space. */
  paths?: Array<{ points: WorldPoint[]; color?: string; width?: number }>;
  /** Filled heat cells (optional, LOD far). */
  cells?: Array<{ rect: WorldRect; color: string; alpha?: number }>;
};

export type InteractionOverlay = {
  marquee?: WorldRect | null;
  lasso?: WorldPoint[] | null;
  handles?: WorldPoint[];
  hoverSeatId?: string | null;
  selectedIds?: ReadonlySet<string> | readonly string[];
};

export type RenderStats = {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  seatsTotal: number;
  seatsDrawn: number;
  seatsCulled: number;
  lod: LodLevel;
  backend: 'webgl2' | 'canvas2d';
  indexBuildMs: number;
  lastCullMs: number;
  lastHitTestMs: number;
  dirtyFrames: number;
  skippedFrames: number;
};

export type CameraState = {
  /** World-space look-at center. */
  x: number;
  y: number;
  /** World units → CSS pixels scale. */
  zoom: number;
};

export type SeatMapRendererOptions = {
  /** Soft zoom clamp (defaults 0.01 … 200). */
  minZoom?: number;
  maxZoom?: number;
  /** Seat world-space radius used for hit tests and drawing. */
  seatRadius?: number;
  /** Spatial hash cell size in world units; auto from pitch when omitted. */
  cellSize?: number;
  /** Background clear color CSS. */
  background?: string;
  /** Prefer Canvas2D even when WebGL2 is available (tests / CI). */
  forceCanvas2d?: boolean;
  /** Disable RAF smoothing for zoom/pan. */
  reducedMotion?: boolean;
};

export type SceneSnapshot = {
  data: SeatMapData;
  bounds: SeatMapBounds;
  seatCount: number;
};

/** Lookup helper that accepts Map or plain object without allocating. */
export function lookupRecord<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  if (!source) return undefined;
  if (source instanceof Map) return source.get(key);
  return (source as Readonly<Record<string, T>>)[key];
}
