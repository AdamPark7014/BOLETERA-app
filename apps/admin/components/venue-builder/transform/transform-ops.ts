import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import type { WorldPoint } from '@boletera/venue-engine/render';
import {
  addSeatsBatchCommand,
  poseOf,
  removeSeatsCommand,
  removeSectionsCommand,
  replaceSceneCommand,
  setVenueMetaCommand,
  transformSeatsCommand,
  updateSectionCommand,
  type RemovedSeat,
  type SeatBatch,
  type SeatPoseEntry,
} from '../store/commands';
import type { EditorStoreApi } from '../store/editor-store';
import type { HistoryStore } from '../store/history-store';
import { selectEditableSeatIds, selectSeatIndex, selectSelectionBounds } from '../store/selectors';
import { convexHull, rotatePoint, scalePoint } from '../utils/geometry';
import { rowLabelAt, slugify, uid } from '../utils/ids';

export type TransformContext = {
  editor: EditorStoreApi;
  history: HistoryStore;
};

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

type SeatWithOwner = { seat: SeatMapSeat; section: SeatMapSection };

/** Selected seats that are not inside a locked zone. */
export function editableSelection(ctx: TransformContext): SeatWithOwner[] {
  const state = ctx.editor.getState();
  const index = selectSeatIndex(state.scene);
  const out: SeatWithOwner[] = [];
  for (const id of selectEditableSeatIds(state)) {
    const hit = index.get(id);
    if (hit) out.push({ seat: hit.seat, section: hit.section });
  }
  return out;
}

function pushPoses(ctx: TransformContext, label: string, entries: SeatPoseEntry[]): void {
  if (entries.length === 0) return;
  ctx.history.execute(transformSeatsCommand(label, entries));
}

function selectionBoundsOf(ctx: TransformContext) {
  const state = ctx.editor.getState();
  return selectSelectionBounds(state.scene, state.selection.seatIds);
}

function selectionPivot(ctx: TransformContext): WorldPoint | null {
  const bounds = selectionBoundsOf(ctx);
  if (!bounds) return null;
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

export function moveSelection(ctx: TransformContext, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const entries = editableSelection(ctx).map(({ seat }) => {
    const before = poseOf(seat);
    return { id: seat.id, before, after: { ...before, x: before.x + dx, y: before.y + dy } };
  });
  pushPoses(ctx, 'Mover selección', entries);
}

export function rotateSelection(ctx: TransformContext, degrees: number): void {
  const pivot = selectionPivot(ctx);
  if (!pivot) return;
  const radians = (degrees * Math.PI) / 180;
  const entries = editableSelection(ctx).map(({ seat }) => {
    const before = poseOf(seat);
    const spun = rotatePoint(before, pivot, radians);
    return {
      id: seat.id,
      before,
      after: { x: spun.x, y: spun.y, rotation: before.rotation + degrees },
    };
  });
  pushPoses(ctx, `Rotar ${degrees}°`, entries);
}

export function scaleSelection(ctx: TransformContext, factorX: number, factorY: number): void {
  const pivot = selectionPivot(ctx);
  if (!pivot) return;
  const entries = editableSelection(ctx).map(({ seat }) => {
    const before = poseOf(seat);
    const scaled = scalePoint(before, pivot, factorX, factorY);
    return { id: seat.id, before, after: { ...before, x: scaled.x, y: scaled.y } };
  });
  pushPoses(ctx, 'Escalar selección', entries);
}

export function alignSelection(ctx: TransformContext, edge: AlignEdge): void {
  const bounds = selectionBoundsOf(ctx);
  if (!bounds) return;
  const entries = editableSelection(ctx).map(({ seat }) => {
    const before = poseOf(seat);
    const after = { ...before };
    if (edge === 'left') after.x = bounds.minX;
    else if (edge === 'right') after.x = bounds.maxX;
    else if (edge === 'hcenter') after.x = (bounds.minX + bounds.maxX) / 2;
    else if (edge === 'top') after.y = bounds.minY;
    else if (edge === 'bottom') after.y = bounds.maxY;
    else after.y = (bounds.minY + bounds.maxY) / 2;
    return { id: seat.id, before, after };
  });
  pushPoses(ctx, 'Alinear selección', entries);
}

export function distributeSelection(ctx: TransformContext, axis: 'x' | 'y'): void {
  const seats = editableSelection(ctx);
  if (seats.length < 3) return;
  const sorted = [...seats].sort((a, b) =>
    axis === 'x' ? a.seat.x - b.seat.x : a.seat.y - b.seat.y,
  );
  const first = sorted[0].seat;
  const last = sorted[sorted.length - 1].seat;
  const origin = axis === 'x' ? first.x : first.y;
  const step = ((axis === 'x' ? last.x : last.y) - origin) / (sorted.length - 1);
  const entries = sorted.map(({ seat }, i) => {
    const before = poseOf(seat);
    const target = origin + step * i;
    return {
      id: seat.id,
      before,
      after: axis === 'x' ? { ...before, x: target } : { ...before, y: target },
    };
  });
  pushPoses(ctx, 'Distribuir selección', entries);
}

export function duplicateSelection(ctx: TransformContext, offset: WorldPoint): void {
  const seats = editableSelection(ctx);
  if (seats.length === 0) return;

  const stamp = uid('dup');
  const bySection = new Map<string, SeatMapSeat[]>();
  const clonedIds: string[] = [];
  for (const { seat, section } of seats) {
    const clone: SeatMapSeat = {
      ...seat,
      id: `${seat.id}-${stamp}`,
      x: seat.x + offset.x,
      y: seat.y + offset.y,
    };
    if (seat.position) clone.position = { ...seat.position, x: clone.x, z: clone.y };
    if (seat.coord3d) clone.coord3d = { ...seat.coord3d, x: clone.x, z: clone.y };
    clonedIds.push(clone.id);
    const list = bySection.get(section.id);
    if (list) list.push(clone);
    else bySection.set(section.id, [clone]);
  }

  const batches: SeatBatch[] = [...bySection].map(([sectionId, seatList]) => ({
    sectionId,
    seats: seatList,
  }));
  ctx.history.execute(addSeatsBatchCommand(`Duplicar ${clonedIds.length} asientos`, batches));
  ctx.editor.getState().selectSeats(clonedIds, 'replace');
}

export function deleteSelection(ctx: TransformContext): void {
  const state = ctx.editor.getState();
  const { selection } = state;

  if (selection.annotationIds.length > 0 || selection.measurementIds.length > 0) {
    state.removeOverlayItems({
      annotationIds: selection.annotationIds,
      measurementIds: selection.measurementIds,
    });
    return;
  }

  if (selection.furnitureIds.length > 0) {
    const furniture = state.scene.venue?.furniture ?? [];
    const keep = furniture.filter((item) => !selection.furnitureIds.includes(item.id));
    ctx.history.execute(
      setVenueMetaCommand('Eliminar mobiliario', { furniture }, { furniture: keep }),
    );
    state.clearSelection();
    return;
  }

  const seats = editableSelection(ctx);
  if (seats.length === 0) return;

  const selected = new Set(seats.map(({ seat }) => seat.id));
  const emptiedSections = state.scene.sections.filter(
    (section) =>
      !section.locked &&
      section.seats.length > 0 &&
      section.seats.every((seat) => selected.has(seat.id)),
  );
  const coveredByWholeSections =
    emptiedSections.length > 0 &&
    seats.every(({ section }) => emptiedSections.some((s) => s.id === section.id));

  if (coveredByWholeSections) {
    ctx.history.execute(
      removeSectionsCommand(`Eliminar ${emptiedSections.length} zonas`, emptiedSections),
    );
    state.clearSelection();
    return;
  }

  const index = selectSeatIndex(state.scene);
  const removed: RemovedSeat[] = [];
  for (const { seat } of seats) {
    const hit = index.get(seat.id);
    if (hit) removed.push({ sectionId: hit.section.id, index: hit.index, seat: hit.seat });
  }
  ctx.history.execute(removeSeatsCommand(`Eliminar ${removed.length} asientos`, removed));
  state.clearSelection();
}

/** Group: move the selected seats into a brand-new zone outlined by their hull. */
export function groupSelection(ctx: TransformContext): void {
  const state = ctx.editor.getState();
  const seats = editableSelection(ctx);
  if (seats.length < 2) return;

  const hull = convexHull(seats.map(({ seat }) => ({ x: seat.x, y: seat.y })));
  const name = `Grupo ${state.scene.sections.length + 1}`;
  const donor = seats[0].section;
  const moved = new Set(seats.map(({ seat }) => seat.id));
  const group: SeatMapSection = {
    id: uid('section'),
    name,
    slug: slugify(name),
    color: donor.color,
    seats: seats.map(({ seat }) => seat),
    shape:
      hull.length >= 3
        ? { points: hull.map((p) => [p.x, p.y] as [number, number]) }
        : undefined,
    seatPitch: donor.seatPitch,
    rowPitch: donor.rowPitch,
    levelId: donor.levelId,
  };

  const before = state.scene;
  const after: SeatMapData = {
    ...before,
    sections: [
      ...before.sections.map((section) => ({
        ...section,
        seats: section.seats.filter((seat) => !moved.has(seat.id)),
      })),
      group,
    ],
  };
  ctx.history.execute(replaceSceneCommand('Agrupar selección', before, after));
  ctx.editor.getState().selectSection(group.id);
}

/** Ungroup: explode a zone into one zone per row. */
export function ungroupSection(ctx: TransformContext, sectionId: string): void {
  const state = ctx.editor.getState();
  const section = state.scene.sections.find((s) => s.id === sectionId);
  if (!section || section.locked) return;

  const byRow = new Map<string, SeatMapSeat[]>();
  section.seats.forEach((seat, i) => {
    const key = seat.row ?? rowLabelAt(i);
    const list = byRow.get(key);
    if (list) list.push(seat);
    else byRow.set(key, [seat]);
  });
  if (byRow.size < 2) return;

  const children: SeatMapSection[] = [...byRow].map(([row, seats]) => {
    const name = `${section.name} · ${row}`;
    return {
      id: uid('section'),
      name,
      slug: slugify(name),
      color: section.color,
      seats,
      seatPitch: section.seatPitch,
      rowPitch: section.rowPitch,
      levelId: section.levelId,
    };
  });

  const before = state.scene;
  const after: SeatMapData = {
    ...before,
    sections: before.sections.flatMap((s) => (s.id === sectionId ? children : [s])),
  };
  ctx.history.execute(replaceSceneCommand('Desagrupar zona', before, after));
  ctx.editor.getState().selectSection(children[0].id);
}

export function setSectionLocked(ctx: TransformContext, sectionId: string, locked: boolean): void {
  const section = ctx.editor.getState().scene.sections.find((s) => s.id === sectionId);
  if (!section) return;
  ctx.history.execute(
    updateSectionCommand(
      locked ? 'Bloquear zona' : 'Desbloquear zona',
      sectionId,
      { locked: section.locked },
      { locked },
    ),
  );
}

/** Marquee / lasso results funnel through here so locked zones stay untouched. */
export function selectableSeatIds(ctx: TransformContext, ids: readonly string[]): string[] {
  const index = selectSeatIndex(ctx.editor.getState().scene);
  return ids.filter((id) => {
    const hit = index.get(id);
    return Boolean(hit && !hit.section.locked);
  });
}
