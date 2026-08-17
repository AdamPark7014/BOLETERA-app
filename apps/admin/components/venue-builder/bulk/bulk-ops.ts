import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import {
  fillShapeWithSeats,
  generateBlock,
  regenerateSeatsFromBlocks,
} from '@boletera/venue-engine';
import type { WorldPoint } from '@boletera/venue-engine/render';
import {
  addSectionsCommand,
  reassignSeatsCommand,
  replaceSceneCommand,
  setSeatAttributesCommand,
  type SeatAttributeEntry,
  type SeatOwnership,
} from '../store/commands';
import { selectSeatIndex } from '../store/selectors';
import { editableSelection, type TransformContext } from '../transform/transform-ops';
import { chunksOf, runChunked, runIdle } from '../utils/chunked';
import { convexHull } from '../utils/geometry';
import { rowLabelAt, slugify, uid } from '../utils/ids';

export type RenumberOptions = {
  /** First seat number in every row. */
  startNumber: number;
  /** Numbering direction along the row. */
  direction: 'ltr' | 'rtl';
  /** Rewrite row letters from the stage outwards instead of keeping them. */
  relabelRows: boolean;
  rowPrefix: string;
};

/** Cluster the selection into rows by Y, then renumber along X. */
export function renumberSelection(ctx: TransformContext, options: RenumberOptions): void {
  const seats = editableSelection(ctx);
  if (seats.length === 0) return;

  const rowTolerance = 6;
  const buckets: Array<{ y: number; seats: SeatMapSeat[] }> = [];
  for (const { seat } of [...seats].sort((a, b) => a.seat.y - b.seat.y)) {
    const bucket = buckets[buckets.length - 1];
    if (bucket && Math.abs(seat.y - bucket.y) <= rowTolerance) bucket.seats.push(seat);
    else buckets.push({ y: seat.y, seats: [seat] });
  }

  const entries: SeatAttributeEntry[] = [];
  buckets.forEach((bucket, rowIndex) => {
    const ordered = [...bucket.seats].sort((a, b) =>
      options.direction === 'ltr' ? a.x - b.x : b.x - a.x,
    );
    const rowLabel = options.relabelRows
      ? `${options.rowPrefix}${rowLabelAt(rowIndex)}`
      : ordered[0].row ?? rowLabelAt(rowIndex);
    ordered.forEach((seat, i) => {
      const number = options.startNumber + i;
      entries.push({
        id: seat.id,
        before: { label: seat.label, row: seat.row, tier: seat.tier },
        after: { label: `${rowLabel}-${number}`, row: rowLabel, tier: seat.tier },
      });
    });
  });

  ctx.history.execute(setSeatAttributesCommand(`Renumerar ${entries.length} asientos`, entries));
}

export function assignTierToSelection(ctx: TransformContext, tier: string): void {
  const seats = editableSelection(ctx);
  if (seats.length === 0) return;
  const entries: SeatAttributeEntry[] = seats.map(({ seat }) => ({
    id: seat.id,
    before: { label: seat.label, row: seat.row, tier: seat.tier },
    after: { label: seat.label, row: seat.row, tier },
  }));
  ctx.history.execute(setSeatAttributesCommand(`Asignar tier "${tier}"`, entries));
}

/** Paint zone: move the selected seats into another zone. */
export function paintSelectionIntoSection(ctx: TransformContext, sectionId: string): void {
  const state = ctx.editor.getState();
  const index = selectSeatIndex(state.scene);
  const before: SeatOwnership[] = [];
  for (const { seat } of editableSelection(ctx)) {
    const hit = index.get(seat.id);
    if (hit && hit.section.id !== sectionId) {
      before.push({ seatId: seat.id, sectionId: hit.section.id });
    }
  }
  if (before.length === 0) return;
  ctx.history.execute(
    reassignSeatsCommand(`Pintar ${before.length} asientos`, before, sectionId),
  );
}

export type BlockSpec = {
  origin: WorldPoint;
  rows: number;
  seatsPerRow: number;
  seatPitch: number;
  rowPitch: number;
  rake: number;
  curvature: number;
  yaw: number;
  tier: string;
};

/**
 * Generate a parametric block. `generateBlock` runs in an idle slice and the
 * per-seat normalization is chunked, so even six-figure blocks keep the render
 * loop responsive.
 */
export async function generateBlockIntoScene(
  ctx: TransformContext,
  spec: BlockSpec,
  targetSectionId: string | null,
): Promise<number> {
  const store = ctx.editor.getState();
  const blockId = uid('block');
  store.setBusy({ label: 'Generando asientos…', progress: 0 });

  const raw = await runIdle(() =>
    generateBlock({
      id: blockId,
      origin: spec.origin,
      rows: spec.rows,
      seatsPerRow: spec.seatsPerRow,
      seatPitch: spec.seatPitch,
      rowPitch: spec.rowPitch,
      rake: spec.rake,
      curvature: spec.curvature,
      yaw: spec.yaw,
      tier: spec.tier,
      idPrefix: blockId,
    }),
  );

  const seats = await runChunked(
    chunksOf(raw, 2000),
    (chunk) => chunk,
    { onProgress: (ratio) => ctx.editor.getState().setBusy({ label: 'Generando asientos…', progress: ratio }) },
  );

  const state = ctx.editor.getState();
  const block = {
    id: blockId,
    origin: spec.origin,
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    seatPitch: spec.seatPitch,
    rowPitch: spec.rowPitch,
    rake: spec.rake,
    curvature: spec.curvature,
    yaw: spec.yaw,
    tier: spec.tier,
  };
  const target = state.scene.sections.find(
    (section) => section.id === targetSectionId && !section.locked,
  );
  const label = `Generar bloque (${seats.length})`;
  const before = state.scene;

  if (target) {
    const after: SeatMapData = {
      ...before,
      sections: before.sections.map((section) =>
        section.id === target.id
          ? {
              ...section,
              seats: [...section.seats, ...seats],
              blocks: [...(section.blocks ?? []), block],
            }
          : section,
      ),
    };
    ctx.history.execute(replaceSceneCommand(label, before, after));
  } else {
    const name = `Zona ${before.sections.length + 1}`;
    const section: SeatMapSection = {
      id: uid('section'),
      name,
      slug: slugify(name),
      color: '#5b9fd4',
      seats,
      seatPitch: spec.seatPitch,
      rowPitch: spec.rowPitch,
      rake: spec.rake,
      curvature: spec.curvature,
      blocks: [block],
    };
    ctx.history.execute(addSectionsCommand(label, [section]));
    ctx.editor.getState().setActiveSection(section.id);
  }

  ctx.editor.getState().setBusy(null);
  return seats.length;
}

/** Fill a zone outline (authored shape, or the hull of its seats) with a grid. */
export function fillSectionWithSeats(
  ctx: TransformContext,
  sectionId: string,
  params: { seatPitch: number; rowPitch: number; rake: number; tier: string },
): number {
  const state = ctx.editor.getState();
  const section = state.scene.sections.find((s) => s.id === sectionId);
  if (!section || section.locked) return 0;

  const authored = section.shape?.points;
  const outline =
    authored && authored.length >= 3
      ? authored
      : convexHull(section.seats.map((seat) => ({ x: seat.x, y: seat.y }))).map(
          (p) => [p.x, p.y] as [number, number],
        );
  if (outline.length < 3) return 0;

  const seats = fillShapeWithSeats({
    shape: { points: outline },
    seatPitch: params.seatPitch,
    rowPitch: params.rowPitch,
    rake: params.rake,
    tier: params.tier,
    idPrefix: uid('fill'),
  });
  if (seats.length === 0) return 0;

  const before = state.scene;
  const after: SeatMapData = {
    ...before,
    sections: before.sections.map((s) =>
      s.id === sectionId ? { ...s, shape: { points: outline }, seats } : s,
    ),
  };
  ctx.history.execute(replaceSceneCommand(`Rellenar zona (${seats.length})`, before, after));
  return seats.length;
}

export function regenerateFromBlocks(ctx: TransformContext, sectionId?: string): void {
  const before = ctx.editor.getState().scene;
  const after = regenerateSeatsFromBlocks(before, sectionId ? { sectionId } : undefined);
  ctx.history.execute(replaceSceneCommand('Regenerar desde bloques', before, after));
}

/** Whole-scene replacement (templates, CAD import, AI suggestion). */
export function replaceScene(ctx: TransformContext, label: string, next: SeatMapData): void {
  const before = ctx.editor.getState().scene;
  ctx.history.execute(replaceSceneCommand(label, before, next));
  ctx.editor.getState().requestFit();
}
