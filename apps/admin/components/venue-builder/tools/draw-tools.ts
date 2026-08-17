import type { SeatMapSeat, SeatMapSection } from '@boletera/shared';
import {
  fillShapeWithSeats,
  generateCurvedRow,
  generateStraightRow,
} from '@boletera/venue-engine';
import type { WorldPoint } from '@boletera/venue-engine/render';
import { addSeatsCommand, addSectionsCommand } from '../store/commands';
import type { EditorStoreApi } from '../store/editor-store';
import { circleFromThreePoints, distance } from '../utils/geometry';
import { slugify, uid } from '../utils/ids';
import type { Tool, ToolContext } from './types';

const SECTION_PALETTE = ['#5b9fd4', '#d4a017', '#22c55e', '#a855f7', '#f97316', '#14b8a6'];

function nextSectionColor(editor: EditorStoreApi): string {
  const count = editor.getState().scene.sections.length;
  return SECTION_PALETTE[count % SECTION_PALETTE.length];
}

function makeSection(editor: EditorStoreApi, name: string, seats: SeatMapSeat[]): SeatMapSection {
  return {
    id: uid('section'),
    name,
    slug: slugify(name),
    color: nextSectionColor(editor),
    seats,
    seatPitch: editor.getState().drawParams.seatPitch,
    rowPitch: editor.getState().drawParams.rowPitch,
  };
}

/** Adds seats to the active zone, creating one when the map is still empty. */
function commitSeats(ctx: ToolContext, label: string, seats: SeatMapSeat[]): void {
  if (seats.length === 0) return;
  const state = ctx.editor.getState();
  const target = state.scene.sections.find(
    (section) => section.id === state.activeSectionId && !section.locked,
  );
  if (target) {
    ctx.history.execute(addSeatsCommand(label, target.id, seats));
  } else {
    const section = makeSection(
      ctx.editor,
      `Zona ${state.scene.sections.length + 1}`,
      seats,
    );
    ctx.history.execute(addSectionsCommand(label, [section]));
    ctx.editor.getState().setActiveSection(section.id);
  }
  ctx.editor.getState().selectSeats(
    seats.map((seat) => seat.id),
    'replace',
  );
}

export function createDrawSectionTool(): Tool {
  let points: WorldPoint[] = [];
  let preview: WorldPoint | null = null;

  const paint = (ctx: ToolContext) => {
    const all = preview ? [...points, preview] : points;
    ctx.editor.getState().setDraft(
      all.length > 0 ? { kind: 'polygon', points: all, closed: false, label: `${points.length} vértices` } : null,
    );
  };

  const clear = (ctx: ToolContext) => {
    points = [];
    preview = null;
    ctx.editor.getState().setDraft(null);
    ctx.clearGuides();
  };

  const commit = (ctx: ToolContext) => {
    if (points.length < 3) {
      clear(ctx);
      return;
    }
    const state = ctx.editor.getState();
    const shape = { points: points.map((p) => [p.x, p.y] as [number, number]) };
    const params = state.drawParams;
    const seats = params.fillOnDraw
      ? fillShapeWithSeats({
          shape,
          seatPitch: params.seatPitch,
          rowPitch: params.rowPitch,
          rake: params.rake,
          tier: params.tier,
          idPrefix: uid('fill'),
        })
      : [];
    const name = `Zona ${state.scene.sections.length + 1}`;
    const section: SeatMapSection = {
      ...makeSection(ctx.editor, name, seats),
      shape,
    };
    ctx.history.execute(addSectionsCommand(`Dibujar ${name}`, [section]));
    ctx.editor.getState().setActiveSection(section.id);
    ctx.editor.getState().selectSection(section.id);
    clear(ctx);
  };

  return {
    id: 'draw-section',
    label: 'Zona',
    shortcut: 'S',
    hint: 'Clic para cada vértice · doble clic o Enter para cerrar la zona',
    cursor: 'crosshair',

    onPointerDown: (ctx, event) => {
      points.push(ctx.snap(event.world).point);
      paint(ctx);
    },

    onPointerMove: (ctx, event) => {
      if (points.length === 0) return;
      preview = ctx.snap(event.world).point;
      paint(ctx);
    },

    onDoubleClick: (ctx) => commit(ctx),
    commit,
    cancel: clear,
  };
}

export function createDrawRowTool(): Tool {
  let anchor: WorldPoint | null = null;
  let end: WorldPoint | null = null;

  const clear = (ctx: ToolContext) => {
    anchor = null;
    end = null;
    ctx.editor.getState().setDraft(null);
    ctx.clearGuides();
  };

  const seatCountFor = (ctx: ToolContext, length: number): number => {
    const pitch = Math.max(1, ctx.editor.getState().drawParams.seatPitch);
    return Math.max(2, Math.round(length / pitch) + 1);
  };

  const commitStraight = (ctx: ToolContext, from: WorldPoint, to: WorldPoint) => {
    const params = ctx.editor.getState().drawParams;
    const length = distance(from, to);
    if (length < params.seatPitch) return;
    const count = seatCountFor(ctx, length);
    const yaw = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const seats = generateStraightRow({
      origin: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      count,
      seatPitch: params.seatPitch,
      yaw,
      tier: params.tier,
      idPrefix: uid('row'),
    });
    commitSeats(ctx, `Fila recta (${count})`, seats);
  };

  const commitCurved = (ctx: ToolContext, a: WorldPoint, b: WorldPoint, c: WorldPoint) => {
    const circle = circleFromThreePoints(a, c, b);
    const params = ctx.editor.getState().drawParams;
    if (!circle) {
      commitStraight(ctx, a, b);
      return;
    }
    const startAngle = Math.atan2(a.y - circle.center.y, a.x - circle.center.x);
    const endAngle = Math.atan2(b.y - circle.center.y, b.x - circle.center.x);
    let span = endAngle - startAngle;
    while (span > Math.PI) span -= Math.PI * 2;
    while (span < -Math.PI) span += Math.PI * 2;
    const arcLength = Math.abs(span) * circle.radius;
    const count = seatCountFor(ctx, arcLength);
    const seats = generateCurvedRow({
      center: circle.center,
      radius: circle.radius,
      count,
      span,
      startAngle,
      seatPitch: params.seatPitch,
      rake: params.rake,
      tier: params.tier,
      idPrefix: uid('arc'),
    });
    commitSeats(ctx, `Fila curva (${count})`, seats);
  };

  return {
    id: 'draw-row',
    label: 'Fila',
    shortcut: 'R',
    hint: 'Recta: arrastra de inicio a fin · Curva: dos clics y un tercero para el arco',
    cursor: 'crosshair',

    onPointerDown: (ctx, event) => {
      const point = ctx.snap(event.world).point;
      const mode = ctx.editor.getState().drawParams.rowMode;
      if (mode === 'straight') {
        anchor = point;
        return;
      }
      if (!anchor) {
        anchor = point;
        return;
      }
      if (!end) {
        end = point;
        return;
      }
      commitCurved(ctx, anchor, end, point);
      clear(ctx);
    },

    onPointerMove: (ctx, event) => {
      if (!anchor) return;
      const point = ctx.snap(event.world).point;
      const mode = ctx.editor.getState().drawParams.rowMode;
      if (mode === 'straight' || !end) {
        ctx.editor.getState().setDraft({
          kind: 'polyline',
          points: [anchor, point],
          label: `${seatCountFor(ctx, distance(anchor, point))} asientos`,
        });
        return;
      }
      const circle = circleFromThreePoints(anchor, point, end);
      if (!circle) return;
      const from = Math.atan2(anchor.y - circle.center.y, anchor.x - circle.center.x);
      const to = Math.atan2(end.y - circle.center.y, end.x - circle.center.x);
      ctx.editor.getState().setDraft({
        kind: 'arc',
        center: circle.center,
        radius: circle.radius,
        from,
        to,
        label: `r ${Math.round(circle.radius)}`,
      });
    },

    onPointerUp: (ctx, event) => {
      if (ctx.editor.getState().drawParams.rowMode !== 'straight' || !anchor) return;
      const to = ctx.snap(event.world).point;
      if (distance(anchor, to) > 1) commitStraight(ctx, anchor, to);
      clear(ctx);
    },

    cancel: clear,
  };
}

export function createDrawSeatTool(): Tool {
  return {
    id: 'draw-seat',
    label: 'Asiento',
    shortcut: 'A',
    hint: 'Clic para colocar un asiento en la zona activa',
    cursor: 'crosshair',

    onPointerDown: (ctx, event) => {
      const state = ctx.editor.getState();
      const point = ctx.snap(event.world).point;
      const section = state.scene.sections.find((s) => s.id === state.activeSectionId);
      const rowLabel = section?.seats[section.seats.length - 1]?.row ?? 'A';
      const number = (section?.seats.length ?? 0) + 1;
      const id = uid('seat');
      const seat: SeatMapSeat = {
        id,
        label: `${rowLabel}-${number}`,
        row: rowLabel,
        x: point.x,
        y: point.y,
        rotation: 0,
        tier: state.drawParams.tier,
        position: { x: point.x, y: 0, z: point.y },
        rotation3d: { x: 0, y: 0, z: 0 },
      };
      commitSeats(ctx, 'Agregar asiento', [seat]);
    },

    onPointerMove: (ctx, event) => {
      const point = ctx.snap(event.world).point;
      ctx.editor.getState().setDraft({ kind: 'dot', at: point });
    },

    cancel: (ctx) => {
      ctx.editor.getState().setDraft(null);
      ctx.clearGuides();
    },
  };
}
