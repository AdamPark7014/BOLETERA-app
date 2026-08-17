import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import type {
  AnalysisOverlay,
  ColorMode,
  LayerId,
  SeatPatch,
  WorldPoint,
} from '@boletera/venue-engine/render';

/** Every interaction mode exposed by the toolbar / keyboard. */
export type ToolId =
  | 'select'
  | 'pan'
  | 'zoom'
  | 'draw-section'
  | 'draw-row'
  | 'draw-seat'
  | 'place-furniture'
  | 'place-stage'
  | 'measure'
  | 'annotate';

export type RowMode = 'straight' | 'curved';

export type FurnitureKind = 'led' | 'speaker' | 'door';

export type RightPanelId =
  | 'properties'
  | 'templates'
  | 'bulk'
  | 'validation'
  | 'io';

/** Everything the user can have selected at once. */
export type EditorSelection = {
  seatIds: string[];
  sectionIds: string[];
  furnitureIds: string[];
  annotationIds: string[];
  measurementIds: string[];
  stage: boolean;
};

export type Measurement = {
  id: string;
  a: WorldPoint;
  b: WorldPoint;
};

export type Annotation = {
  id: string;
  at: WorldPoint;
  text: string;
};

/** Magnetic guide drawn by the SVG overlay while a tool snaps. */
export type SnapGuide =
  | { axis: 'x'; value: number }
  | { axis: 'y'; value: number };

/** Live preview geometry produced by draw tools before they commit. */
export type ToolDraft =
  | { kind: 'polygon'; points: WorldPoint[]; closed: boolean; label?: string }
  | { kind: 'polyline'; points: WorldPoint[]; label?: string }
  | { kind: 'rect'; a: WorldPoint; b: WorldPoint; label?: string }
  | { kind: 'arc'; center: WorldPoint; radius: number; from: number; to: number; label?: string }
  | { kind: 'dot'; at: WorldPoint; label?: string };

export type BackgroundUnderlay = {
  kind: 'image' | 'pdf';
  url: string;
  name: string;
  /** World-space placement of the underlay's top-left corner. */
  x: number;
  y: number;
  /** World-space size. */
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
};

export type LayerFlags = { visible: boolean; locked: boolean };

/** Parameters shared by the generative tools and the bulk panel. */
export type DrawParams = {
  rowMode: RowMode;
  seatPitch: number;
  rowPitch: number;
  rows: number;
  seatsPerRow: number;
  rake: number;
  curvature: number;
  tier: string;
  furnitureKind: FurnitureKind;
  /** Fill freshly drawn section polygons with a seat grid. */
  fillOnDraw: boolean;
};

export type ValidationState = {
  ranAt: number;
  issues: Array<{
    code: string;
    severity: 'warning' | 'error';
    message: string;
    seatIds: string[];
    sectionIds: string[];
  }>;
  sightlineSummary: Record<string, number> | null;
  /** Feeds the renderer's `sightline` color mode. */
  sightlineBySeatId: Record<string, number> | null;
  egress: {
    hasNetwork: boolean;
    clearanceMinutes: number | null;
    unreachable: number;
    maxPathLength: number | null;
    exitCount: number;
  } | null;
  overlays: AnalysisOverlay[];
};

/** Result of a command: a new scene plus an optional fast seat patch. */
export type SceneMutation = {
  scene: SeatMapData;
  /** When present the renderer applies `updateSeats` instead of `setScene`. */
  patch?: SeatPatch[];
};

/**
 * Reversible mutation. `apply`/`revert` are pure with respect to the scene they
 * receive, so the same command can be replayed any number of times.
 */
export type EditorCommand = {
  id: string;
  label: string;
  apply: (scene: SeatMapData) => SceneMutation;
  revert: (scene: SeatMapData) => SceneMutation;
};

export type ClipboardPayload = {
  sections: SeatMapSection[];
  /** Bounding-box origin used to paste relative to the pointer. */
  origin: WorldPoint;
};

export type EditorState = {
  scene: SeatMapData;
  /** Bumped whenever the renderer needs a full `setScene`. */
  structuralEpoch: number;
  /** Bumped whenever `pendingPatch` can be pushed through `updateSeats`. */
  patchEpoch: number;
  pendingPatch: readonly SeatPatch[];
  /** Set once after a scene replacement so the bridge can fit the camera. */
  fitRequestEpoch: number;

  selection: EditorSelection;
  hoverSeatId: string | null;
  activeSectionId: string | null;

  tool: ToolId;
  /** Tool to restore after a transient space-bar pan. */
  toolBeforeTransient: ToolId | null;

  colorMode: ColorMode;
  layers: Record<LayerId, LayerFlags>;
  hiddenSectionIds: string[];

  snapEnabled: boolean;
  snapPitch: number;
  guides: SnapGuide[];
  draft: ToolDraft | null;

  measurements: Measurement[];
  annotations: Annotation[];
  underlay: BackgroundUnderlay | null;

  drawParams: DrawParams;
  validation: ValidationState | null;

  clipboard: ClipboardPayload | null;

  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  rightPanel: RightPanelId;
  shortcutsOpen: boolean;
  fullscreen: boolean;

  dirty: boolean;
  status: string | null;
  busy: { label: string; progress: number } | null;
};
