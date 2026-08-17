import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import type { WorldRect } from '@boletera/venue-engine/render';
import type { EditorState } from './types';

export type SeatLookup = {
  seat: SeatMapSeat;
  section: SeatMapSection;
  /** Index of the seat inside its section, used by reversible deletes. */
  index: number;
};

type Cache<K, V> = { key: K | null; value: V | null };

function cached<K, V>(cache: Cache<K, V>, key: K, build: () => V): V {
  if (cache.key === key && cache.value !== null) return cache.value;
  const value = build();
  cache.key = key;
  cache.value = value;
  return value;
}

const seatIndexCache: Cache<SeatMapData, Map<string, SeatLookup>> = { key: null, value: null };

/** O(1) seat resolution shared by tools, panels and transforms. */
export function selectSeatIndex(scene: SeatMapData): Map<string, SeatLookup> {
  return cached(seatIndexCache, scene, () => {
    const index = new Map<string, SeatLookup>();
    for (const section of scene.sections) {
      section.seats.forEach((seat, i) => index.set(seat.id, { seat, section, index: i }));
    }
    return index;
  });
}

const totalSeatsCache: Cache<SeatMapData, number> = { key: null, value: null };

export function selectTotalSeats(scene: SeatMapData): number {
  return cached(totalSeatsCache, scene, () =>
    scene.sections.reduce((sum, section) => sum + section.seats.length, 0),
  );
}

const renderSceneCache: Cache<string, SeatMapData> = { key: null, value: null };
let renderSceneSource: SeatMapData | null = null;

/**
 * Scene handed to the renderer. Hidden sections are removed entirely so they are
 * neither drawn nor hit-testable — no per-seat DOM or per-seat filtering needed.
 */
export function selectRenderScene(state: EditorState): SeatMapData {
  if (state.hiddenSectionIds.length === 0) return state.scene;
  const key = `${state.structuralEpoch}:${state.hiddenSectionIds.join(',')}`;
  if (renderSceneCache.key === key && renderSceneCache.value && renderSceneSource === state.scene) {
    return renderSceneCache.value;
  }
  const hidden = new Set(state.hiddenSectionIds);
  const value: SeatMapData = {
    ...state.scene,
    sections: state.scene.sections.filter((section) => !hidden.has(section.id)),
  };
  renderSceneCache.key = key;
  renderSceneCache.value = value;
  renderSceneSource = state.scene;
  return value;
}

/** World AABB of a set of seats (null when none of them resolve). */
export function selectSelectionBounds(
  scene: SeatMapData,
  seatIds: readonly string[],
): WorldRect | null {
  const index = selectSeatIndex(scene);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const id of seatIds) {
    const hit = index.get(id);
    if (!hit) continue;
    found = true;
    if (hit.seat.x < minX) minX = hit.seat.x;
    if (hit.seat.y < minY) minY = hit.seat.y;
    if (hit.seat.x > maxX) maxX = hit.seat.x;
    if (hit.seat.y > maxY) maxY = hit.seat.y;
  }
  if (!found) return null;
  return { minX, minY, maxX, maxY };
}

export function selectSection(
  scene: SeatMapData,
  sectionId: string | null,
): SeatMapSection | null {
  if (!sectionId) return null;
  return scene.sections.find((section) => section.id === sectionId) ?? null;
}

/** Sections that own at least one selected seat. */
export function selectSectionsOfSelection(state: EditorState): SeatMapSection[] {
  const index = selectSeatIndex(state.scene);
  const seen = new Set<string>();
  const out: SeatMapSection[] = [];
  for (const id of state.selection.seatIds) {
    const hit = index.get(id);
    if (!hit || seen.has(hit.section.id)) continue;
    seen.add(hit.section.id);
    out.push(hit.section);
  }
  return out;
}

export function selectionIsEmpty(state: EditorState): boolean {
  const s = state.selection;
  return (
    s.seatIds.length === 0 &&
    s.sectionIds.length === 0 &&
    s.furnitureIds.length === 0 &&
    s.annotationIds.length === 0 &&
    s.measurementIds.length === 0 &&
    !s.stage
  );
}

/** Seats that can be edited: seats inside locked sections are excluded. */
export function selectEditableSeatIds(state: EditorState): string[] {
  const index = selectSeatIndex(state.scene);
  return state.selection.seatIds.filter((id) => {
    const hit = index.get(id);
    return Boolean(hit && !hit.section.locked);
  });
}
