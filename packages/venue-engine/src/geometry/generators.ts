import type { SeatMapBlock, SeatMapSeat } from '@boletera/shared';
import {
  numberRow,
  rowLabelAt,
  type NumberingConvention,
} from './numbering';

export type StraightRowOptions = {
  origin: { x: number; y: number };
  count: number;
  seatPitch: number;
  /** Yaw degrees — facing direction of the row */
  yaw?: number;
  elevation?: number;
  /** Pitch degrees applied as rotation3d.x */
  pitch?: number;
  rowLabel?: string;
  idPrefix?: string;
  startNumber?: number;
  tier?: string;
  /** Convención de numeración del recinto (pares/impares, letras sin I ni O, …) */
  numbering?: NumberingConvention;
};

export type CurvedRowOptions = {
  center: { x: number; y: number };
  radius: number;
  count: number;
  /** Angular span in radians; if omitted, derived from seatPitch along arc */
  span?: number;
  startAngle?: number;
  seatPitch?: number;
  elevation?: number;
  rake?: number;
  rowLabel?: string;
  idPrefix?: string;
  startNumber?: number;
  tier?: string;
  /** Vertical squash of arc (theater foreshortening); 1 = circle */
  yScale?: number;
  /** Extra facing offset in degrees */
  facingOffset?: number;
  /** Convención de numeración del recinto */
  numbering?: NumberingConvention;
};

export type BlockOptions = SeatMapBlock & {
  idPrefix?: string;
  skipColumns?: number[];
  /** Visual facing degrees; defaults to `yaw` (layout orientation) */
  facing?: number;
  /** Convención de numeración del recinto */
  numbering?: NumberingConvention;
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

/**
 * Etiqueta de fila.
 *
 * Antes esto era `String.fromCharCode(65 + index)`, que a partir de la fila 26
 * emite `[`, `\`, `]`… y nunca saltaba la I ni la O. Ahora delega en la
 * convención del recinto, cuyo valor por defecto omite las letras ambiguas.
 */
function rowLabelFromIndex(
  start: string | undefined,
  index: number,
  numbering?: NumberingConvention,
  totalRows?: number,
): string {
  return rowLabelAt(index, { ...numbering, startRowLabel: start ?? numbering?.startRowLabel }, totalRows);
}

/** Generate a straight row of seats with consistent spacing (no overlaps). */
export function generateStraightRow(opts: StraightRowOptions): SeatMapSeat[] {
  const {
    origin,
    count,
    seatPitch,
    yaw = 0,
    elevation = 0,
    pitch = 0,
    rowLabel = 'A',
    idPrefix = 'row',
    startNumber = 1,
    tier,
    numbering,
  } = opts;
  const rad = degToRad(yaw);
  // Along-row axis for yaw=0 is +X (stage at low Y / north)
  const alongX = Math.cos(rad);
  const alongY = Math.sin(rad);
  const seats: SeatMapSeat[] = [];
  const half = ((count - 1) * seatPitch) / 2;

  // La numeración de toda la fila se resuelve de una vez: las convenciones
  // desde el centro necesitan conocer el total de butacas.
  const numbers = numberRow(count, rowLabel, { startSeatNumber: startNumber, ...numbering });

  for (let i = 0; i < count; i++) {
    const offset = -half + i * seatPitch;
    const x = origin.x + alongX * offset;
    const y = origin.y + alongY * offset;
    const n = numbers[i].number;
    seats.push({
      id: `${idPrefix}-${rowLabel}-${n}`,
      label: numbers[i].label,
      row: rowLabel,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rotation: yaw,
      tier,
      elevation,
      position: { x, y: elevation, z: y },
      rotation3d: { x: pitch, y: yaw, z: 0 },
      coord3d: { x, y: elevation, z: y, pitch, roll: 0 },
    });
  }
  return seats;
}

/** Generate a curved row facing the arc center (bowl / theater). */
export function generateCurvedRow(opts: CurvedRowOptions): SeatMapSeat[] {
  const {
    center,
    radius,
    count,
    seatPitch = 22,
    elevation = 0,
    rake = 0,
    rowLabel = 'A',
    idPrefix = 'arc',
    startNumber = 1,
    tier,
    yScale = 1,
    facingOffset = 0,
    numbering,
  } = opts;

  const arcLen = Math.max(0.01, count > 1 ? (count - 1) * seatPitch : seatPitch);
  const span = opts.span ?? arcLen / Math.max(radius, 1);
  const startAngle = opts.startAngle ?? -span / 2 - Math.PI / 2;
  const seats: SeatMapSeat[] = [];

  const numbers = numberRow(count, rowLabel, { startSeatNumber: startNumber, ...numbering });

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = startAngle + t * span;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius * yScale;
    const yaw = ((angle + Math.PI / 2) * 180) / Math.PI + facingOffset;
    const elev = elevation + rake;
    const n = numbers[i].number;
    seats.push({
      id: `${idPrefix}-${rowLabel}-${n}`,
      label: numbers[i].label,
      row: rowLabel,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rotation: yaw,
      tier,
      elevation: elev,
      position: { x, y: elev, z: y },
      rotation3d: { x: 0, y: yaw, z: 0 },
      coord3d: { x, y: elev, z: y },
    });
  }
  return seats;
}

/**
 * Generate a rectangular or gently curved seating block with rake.
 * Curvature > 0 pulls mid-row seats toward -Y (stage-forward) using a parabolic bias.
 */
export function generateBlock(opts: BlockOptions): SeatMapSeat[] {
  const {
    id,
    origin,
    rows,
    seatsPerRow,
    seatPitch,
    rowPitch,
    rake = 0,
    curvature = 0,
    yaw = 0,
    elevation = 0,
    startRowLabel,
    tier,
    idPrefix,
    skipColumns = [],
    facing,
    numbering,
  } = opts;

  const prefix = idPrefix ?? id;
  const faceDeg = facing ?? yaw;
  const rad = degToRad(yaw);
  const alongX = Math.cos(rad);
  const alongY = Math.sin(rad);
  const depthX = -Math.sin(rad);
  const depthY = Math.cos(rad);
  const seats: SeatMapSeat[] = [];
  const skip = new Set(skipColumns);

  // Las columnas saltadas son pasillos: no consumen número de butaca. Se numera
  // sobre las butacas realmente ocupadas, que es lo que ve el acomodador.
  const occupiedColumns: number[] = [];
  for (let c = 0; c < seatsPerRow; c++) if (!skip.has(c)) occupiedColumns.push(c);
  const seatsInRow = occupiedColumns.length;

  let seatsBefore = 0;
  for (let r = 0; r < rows; r++) {
    const rowLabel = rowLabelFromIndex(startRowLabel, r, numbering, rows);
    const elev = elevation + r * rake;
    const pitch = rake > 0 ? Math.min(18, rake * 2.2) : 0;
    const half = ((seatsPerRow - 1) * seatPitch) / 2;

    const numbers = numberRow(seatsInRow, rowLabel, numbering, r, seatsBefore);

    for (let k = 0; k < seatsInRow; k++) {
      const c = occupiedColumns[k];
      const lateral = -half + c * seatPitch;
      const midT = seatsPerRow === 1 ? 0 : (c / (seatsPerRow - 1) - 0.5) * 2;
      const curveBias = curvature > 0 ? midT * midT * curvature * (r + 1) * 0.35 : 0;
      const x = origin.x + alongX * lateral + depthX * (r * rowPitch + curveBias);
      const y = origin.y + alongY * lateral + depthY * (r * rowPitch + curveBias);
      const n = numbers[k].number;
      seats.push({
        id: `${prefix}-${rowLabel}-${n}`,
        label: numbers[k].label,
        row: rowLabel,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        rotation: faceDeg,
        tier: tier ?? (r < 2 ? 'premium' : r >= rows - 2 ? 'economy' : 'standard'),
        elevation: elev,
        position: { x, y: elev, z: y },
        rotation3d: { x: pitch, y: faceDeg, z: 0 },
        coord3d: { x, y: elev, z: y, pitch, roll: 0 },
      });
    }
    seatsBefore += seatsInRow;
  }
  return seats;
}
