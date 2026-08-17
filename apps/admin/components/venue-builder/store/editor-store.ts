import { create } from 'zustand';
import type { SeatMapData } from '@boletera/shared';
import { defaultRowPitchMap, defaultSeatPitchMap, migrateToV3 } from '@boletera/venue-engine';
import {
  DEFAULT_LAYER_ORDER,
  type ColorMode,
  type LayerId,
  type SeatPatch,
} from '@boletera/venue-engine/render';
import type {
  Annotation,
  BackgroundUnderlay,
  ClipboardPayload,
  DrawParams,
  EditorSelection,
  EditorState,
  LayerFlags,
  Measurement,
  RightPanelId,
  SceneMutation,
  SnapGuide,
  ToolDraft,
  ToolId,
  ValidationState,
} from './types';

const EMPTY_SELECTION: EditorSelection = {
  seatIds: [],
  sectionIds: [],
  furnitureIds: [],
  annotationIds: [],
  measurementIds: [],
  stage: false,
};

function defaultLayers(): Record<LayerId, LayerFlags> {
  const out = {} as Record<LayerId, LayerFlags>;
  for (const id of DEFAULT_LAYER_ORDER) out[id] = { visible: true, locked: false };
  return out;
}

function defaultDrawParams(scale: number): DrawParams {
  return {
    rowMode: 'straight',
    seatPitch: defaultSeatPitchMap(scale),
    rowPitch: defaultRowPitchMap(scale),
    rows: 8,
    seatsPerRow: 16,
    rake: 0,
    curvature: 0,
    tier: 'standard',
    furnitureKind: 'led',
    fillOnDraw: true,
  };
}

function venueScale(scene: SeatMapData): number {
  const scale = scene.venue?.scale;
  return typeof scale === 'number' && scale > 0 ? scale : 40;
}

function initialSnapPitch(scene: SeatMapData): number {
  const authored = scene.venue?.snapPitch;
  if (typeof authored === 'number' && authored > 0) return authored;
  return Math.max(1, Math.round(defaultSeatPitchMap(venueScale(scene)) / 2));
}

export type EditorActions = {
  /** Load an externally supplied map (initial mount, save round-trip, template). */
  loadScene: (next: SeatMapData, options?: { fit?: boolean; keepSelection?: boolean }) => void;
  /** Apply a command result. Structural results force a renderer rebuild. */
  commit: (mutation: SceneMutation) => void;
  markSaved: () => void;

  setTool: (tool: ToolId) => void;
  beginTransientTool: (tool: ToolId) => void;
  endTransientTool: () => void;

  setSelection: (selection: Partial<EditorSelection>) => void;
  selectSeats: (ids: readonly string[], mode?: 'replace' | 'add' | 'toggle') => void;
  selectSection: (id: string, mode?: 'replace' | 'add') => void;
  clearSelection: () => void;
  setHoverSeat: (id: string | null) => void;
  setActiveSection: (id: string | null) => void;

  setColorMode: (mode: ColorMode) => void;
  setLayerFlag: (layer: LayerId, flag: keyof LayerFlags, value: boolean) => void;
  toggleSectionHidden: (sectionId: string) => void;

  setSnapEnabled: (enabled: boolean) => void;
  setSnapPitch: (pitch: number) => void;
  setGuides: (guides: SnapGuide[]) => void;
  setDraft: (draft: ToolDraft | null) => void;

  addMeasurement: (measurement: Measurement) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, text: string) => void;
  removeOverlayItems: (ids: { annotationIds?: string[]; measurementIds?: string[] }) => void;

  setUnderlay: (underlay: BackgroundUnderlay | null) => void;
  patchUnderlay: (patch: Partial<BackgroundUnderlay>) => void;

  setDrawParams: (patch: Partial<DrawParams>) => void;
  setValidation: (validation: ValidationState | null) => void;
  setClipboard: (payload: ClipboardPayload | null) => void;

  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanel: (panel: RightPanelId) => void;
  setShortcutsOpen: (open: boolean) => void;
  setFullscreen: (full: boolean) => void;

  setStatus: (status: string | null) => void;
  setBusy: (busy: { label: string; progress: number } | null) => void;
  requestFit: () => void;
};

export type EditorStore = EditorState & EditorActions;

function createInitialState(initial: SeatMapData): EditorState {
  const scene = migrateToV3(initial);
  return {
    scene,
    structuralEpoch: 1,
    patchEpoch: 0,
    pendingPatch: [],
    fitRequestEpoch: 1,

    selection: EMPTY_SELECTION,
    hoverSeatId: null,
    activeSectionId: scene.sections[0]?.id ?? null,

    tool: 'select',
    toolBeforeTransient: null,

    colorMode: 'zone',
    layers: defaultLayers(),
    hiddenSectionIds: [],

    snapEnabled: true,
    snapPitch: initialSnapPitch(scene),
    guides: [],
    draft: null,

    measurements: [],
    annotations: [],
    underlay: null,

    drawParams: defaultDrawParams(venueScale(scene)),
    validation: null,

    clipboard: null,

    leftPanelOpen: true,
    rightPanelOpen: true,
    rightPanel: 'properties',
    shortcutsOpen: false,
    fullscreen: false,

    dirty: false,
    status: null,
    busy: null,
  };
}

function mergeSeatSelection(
  current: readonly string[],
  incoming: readonly string[],
  mode: 'replace' | 'add' | 'toggle',
): string[] {
  if (mode === 'replace') return [...incoming];
  const set = new Set(current);
  if (mode === 'add') {
    for (const id of incoming) set.add(id);
    return [...set];
  }
  for (const id of incoming) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }
  return [...set];
}

/**
 * Single source of truth for the editor. The renderer is *not* React state:
 * it is driven by the `structuralEpoch` / `patchEpoch` counters so a drag can
 * push thousands of seat updates without re-rendering a single component.
 */
export function createEditorStore(initial: SeatMapData) {
  return create<EditorStore>((set) => ({
    ...createInitialState(initial),

    loadScene: (next, options) =>
      set((state) => ({
        scene: migrateToV3(next),
        structuralEpoch: state.structuralEpoch + 1,
        fitRequestEpoch:
          options?.fit === false ? state.fitRequestEpoch : state.fitRequestEpoch + 1,
        selection: options?.keepSelection ? state.selection : EMPTY_SELECTION,
        activeSectionId: next.sections[0]?.id ?? null,
        pendingPatch: [],
        validation: null,
        dirty: false,
      })),

    commit: (mutation) =>
      set((state) => {
        if (mutation.patch && mutation.patch.length > 0) {
          return {
            scene: mutation.scene,
            pendingPatch: mutation.patch as readonly SeatPatch[],
            patchEpoch: state.patchEpoch + 1,
            dirty: true,
          };
        }
        return {
          scene: mutation.scene,
          structuralEpoch: state.structuralEpoch + 1,
          pendingPatch: [],
          dirty: true,
        };
      }),

    markSaved: () => set({ dirty: false }),

    setTool: (tool) => set({ tool, draft: null, guides: [], toolBeforeTransient: null }),

    beginTransientTool: (tool) =>
      set((state) =>
        state.tool === tool
          ? {}
          : { tool, toolBeforeTransient: state.toolBeforeTransient ?? state.tool },
      ),

    endTransientTool: () =>
      set((state) =>
        state.toolBeforeTransient
          ? { tool: state.toolBeforeTransient, toolBeforeTransient: null }
          : {},
      ),

    setSelection: (selection) =>
      set((state) => ({ selection: { ...state.selection, ...selection } })),

    selectSeats: (ids, mode = 'replace') =>
      set((state) => ({
        selection: {
          ...state.selection,
          seatIds: mergeSeatSelection(state.selection.seatIds, ids, mode),
          ...(mode === 'replace'
            ? { sectionIds: [], furnitureIds: [], annotationIds: [], measurementIds: [], stage: false }
            : {}),
        },
      })),

    selectSection: (id, mode = 'replace') =>
      set((state) => {
        const section = state.scene.sections.find((s) => s.id === id);
        const seatIds = section ? section.seats.map((s) => s.id) : [];
        return {
          activeSectionId: id,
          selection: {
            ...EMPTY_SELECTION,
            sectionIds:
              mode === 'add' && !state.selection.sectionIds.includes(id)
                ? [...state.selection.sectionIds, id]
                : [id],
            seatIds:
              mode === 'add'
                ? mergeSeatSelection(state.selection.seatIds, seatIds, 'add')
                : seatIds,
          },
        };
      }),

    clearSelection: () => set({ selection: EMPTY_SELECTION }),

    setHoverSeat: (id) => set((state) => (state.hoverSeatId === id ? {} : { hoverSeatId: id })),

    setActiveSection: (id) => set({ activeSectionId: id }),

    setColorMode: (mode) => set({ colorMode: mode }),

    setLayerFlag: (layer, flag, value) =>
      set((state) => ({
        layers: { ...state.layers, [layer]: { ...state.layers[layer], [flag]: value } },
      })),

    toggleSectionHidden: (sectionId) =>
      set((state) => {
        const hidden = state.hiddenSectionIds.includes(sectionId)
          ? state.hiddenSectionIds.filter((id) => id !== sectionId)
          : [...state.hiddenSectionIds, sectionId];
        return { hiddenSectionIds: hidden, structuralEpoch: state.structuralEpoch + 1 };
      }),

    setSnapEnabled: (enabled) => set({ snapEnabled: enabled, guides: [] }),

    setSnapPitch: (pitch) => set({ snapPitch: Math.max(1, Math.round(pitch)) }),

    setGuides: (guides) =>
      set((state) => (state.guides.length === 0 && guides.length === 0 ? {} : { guides })),

    setDraft: (draft) => set({ draft }),

    addMeasurement: (measurement) =>
      set((state) => ({ measurements: [...state.measurements, measurement] })),

    addAnnotation: (annotation) =>
      set((state) => ({
        annotations: [...state.annotations, annotation],
        selection: { ...EMPTY_SELECTION, annotationIds: [annotation.id] },
      })),

    updateAnnotation: (id, text) =>
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === id ? { ...a, text } : a)),
      })),

    removeOverlayItems: (ids) =>
      set((state) => ({
        annotations: ids.annotationIds?.length
          ? state.annotations.filter((a) => !ids.annotationIds?.includes(a.id))
          : state.annotations,
        measurements: ids.measurementIds?.length
          ? state.measurements.filter((m) => !ids.measurementIds?.includes(m.id))
          : state.measurements,
        selection: { ...state.selection, annotationIds: [], measurementIds: [] },
      })),

    setUnderlay: (underlay) => set({ underlay }),

    patchUnderlay: (patch) =>
      set((state) => (state.underlay ? { underlay: { ...state.underlay, ...patch } } : {})),

    setDrawParams: (patch) =>
      set((state) => ({ drawParams: { ...state.drawParams, ...patch } })),

    setValidation: (validation) => set({ validation }),

    setClipboard: (payload) => set({ clipboard: payload }),

    setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
    setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
    setRightPanel: (panel) => set({ rightPanel: panel, rightPanelOpen: true }),
    setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
    setFullscreen: (full) => set({ fullscreen: full }),

    setStatus: (status) => set({ status }),
    setBusy: (busy) => set({ busy }),
    requestFit: () => set((state) => ({ fitRequestEpoch: state.fitRequestEpoch + 1 })),
  }));
}

export type EditorStoreApi = ReturnType<typeof createEditorStore>;

export { EMPTY_SELECTION, venueScale };
