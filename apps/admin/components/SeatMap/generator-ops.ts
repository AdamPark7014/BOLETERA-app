import type { SeatMapBlock, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import {
  generateBlock,
  generateCurvedRow,
  generateLayoutTemplate,
  generateStraightRow,
  rowLabelAt,
  type LayoutTemplateId,
  type NumberingConvention,
} from '@boletera/venue-engine';

export type BlockParams = {
  rows: number;
  cols: number;
  seatPitch: number;
  rowPitch: number;
  rake: number;
  curvature: number;
  skipColumns: string;
};

export type GeneratorTab =
  | 'section'
  | 'row'
  | 'curved'
  | 'tables'
  | 'ga'
  | 'template'
  | 'renumber';

export type SectionGeneratorParams = {
  rows: number;
  cols: number;
  seatPitch: number;
  rowPitch: number;
  rake: number;
  curvature: number;
  skipColumns: string;
  tier: string;
  startRowLabel: string;
  yaw: number;
  numbering: NumberingConvention;
  createNewSection: boolean;
  sectionName: string;
};

export type RowGeneratorParams = {
  count: number;
  seatPitch: number;
  yaw: number;
  rake: number;
  rowLabel: string;
  startNumber: number;
  tier: string;
  numbering: NumberingConvention;
};

export type CurvedGeneratorParams = {
  count: number;
  radius: number;
  spanDeg: number;
  seatPitch: number;
  rake: number;
  rowLabel: string;
  tier: string;
  yScale: number;
  numbering: NumberingConvention;
};

export type TablesGeneratorParams = {
  tableCount: number;
  tablesPerRow: number;
  seatsPerTable: number;
  tablePitch: number;
  seatPitch: number;
  tier: string;
};

export type GaGeneratorParams = {
  name: string;
  width: number;
  height: number;
  capacity: number;
};

export type TemplateGeneratorParams = {
  template: LayoutTemplateId;
  capacity: number;
};

export type RenumberParams = {
  startNumber: number;
  direction: 'ltr' | 'rtl';
  relabelRows: boolean;
  rowPrefix: string;
};

export type GeneratorPreviewStats = {
  seatCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  sampleLabels: string[];
  summary: string;
};

export type GeneratorPreviewResult = {
  stats: GeneratorPreviewStats;
  seats: SeatMapSeat[];
  block?: SeatMapBlock;
  gaSection?: SeatMapSection;
  templateMap?: SeatMapData;
  renumberUpdates?: Array<{ id: string; label: string; row: string }>;
};

type PlacementContext = {
  map: SeatMapData;
  activeSection?: SeatMapSection | null;
  blockParams: BlockParams;
};

function boundsOfSeats(seats: SeatMapSeat[]) {
  if (!seats.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const xs = seats.map((s) => s.x);
  const ys = seats.map((s) => s.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function previewStats(seats: SeatMapSeat[], summary: string): GeneratorPreviewStats {
  const bounds = boundsOfSeats(seats);
  const sampleLabels = seats.slice(0, 6).map((s) => s.label);
  if (seats.length > 6) sampleLabels.push(`… +${seats.length - 6}`);
  return {
    seatCount: seats.length,
    bounds,
    sampleLabels,
    summary,
  };
}

export function parseSkipColumns(raw: string, cols: number): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const every = /^every:(\d+)$/i.exec(trimmed);
  if (every) {
    const n = Number(every[1]);
    if (!n) return [];
    return Array.from({ length: cols }, (_, c) => c).filter((c) => c > 0 && c % n === 0);
  }
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0 && n < cols);
}

/** Origin below active section seats or in front of the stage. */
export function generatorPlacement(ctx: PlacementContext): { x: number; y: number; elevation: number } {
  const { activeSection, map, blockParams } = ctx;
  if (activeSection?.seats.length) {
    const cols = blockParams.cols;
    const pitch = activeSection.seatPitch ?? blockParams.seatPitch;
    return {
      x:
        Math.min(...activeSection.seats.map((s) => s.x)) +
        ((cols - 1) * pitch) / 2,
      y:
        Math.max(...activeSection.seats.map((s) => s.y)) +
        (activeSection.rowPitch ?? blockParams.rowPitch),
      elevation:
        Math.max(...activeSection.seats.map((s) => s.elevation ?? 0)) +
        (activeSection.rake ?? blockParams.rake),
    };
  }
  const stage = map.venue?.stage;
  const x = stage ? stage.x + stage.width / 2 : 400;
  const y = (stage?.y ?? 0) + (stage ? 90 : 120);
  return { x, y, elevation: 0 };
}

function stampSeatIds(seats: SeatMapSeat[], prefix: string): SeatMapSeat[] {
  const ts = Date.now();
  return seats.map((s, i) => ({ ...s, id: `${prefix}-${ts}-${i}` }));
}

export function previewSectionBlock(
  ctx: PlacementContext,
  params: SectionGeneratorParams,
): GeneratorPreviewResult {
  const origin = generatorPlacement(ctx);
  const skip = parseSkipColumns(params.skipColumns, params.cols);
  const blockId = `gen-block-preview`;
  const block: SeatMapBlock = {
    id: blockId,
    label: `${params.rows}×${params.cols}`,
    origin: { x: origin.x, y: origin.y },
    rows: params.rows,
    seatsPerRow: params.cols,
    seatPitch: params.seatPitch,
    rowPitch: params.rowPitch,
    rake: params.rake,
    curvature: params.curvature,
    yaw: params.yaw,
    elevation: origin.elevation,
    startRowLabel: params.startRowLabel,
    tier: params.tier,
    skipColumns: skip,
  };
  const raw = generateBlock({ ...block, idPrefix: blockId, numbering: params.numbering });
  const seats = stampSeatIds(raw, 'preview');
  const occupied = params.rows * (params.cols - skip.length);
  return {
    stats: previewStats(
      seats,
      `Sección ${params.rows} filas × ${params.cols} butacas (${occupied.toLocaleString('es-MX')} asientos, ${skip.length ? 'con pasillos' : 'sin pasillos'})`,
    ),
    seats,
    block,
  };
}

export function previewStraightRow(
  ctx: PlacementContext,
  params: RowGeneratorParams,
): GeneratorPreviewResult {
  const origin = generatorPlacement(ctx);
  const raw = generateStraightRow({
    origin: { x: origin.x, y: origin.y },
    count: params.count,
    seatPitch: params.seatPitch,
    yaw: params.yaw,
    elevation: origin.elevation + params.rake,
    rowLabel: params.rowLabel,
    idPrefix: 'preview-row',
    startNumber: params.startNumber,
    tier: params.tier,
    numbering: params.numbering,
  });
  const seats = stampSeatIds(raw, 'preview');
  return {
    stats: previewStats(seats, `Fila recta · ${params.count} butacas · fila ${params.rowLabel}`),
    seats,
  };
}

export function previewCurvedRow(
  ctx: PlacementContext,
  params: CurvedGeneratorParams,
): GeneratorPreviewResult {
  const origin = generatorPlacement(ctx);
  const cx = origin.x;
  const centerY = origin.y - params.radius + 40;
  const span = (params.spanDeg * Math.PI) / 180;
  const raw = generateCurvedRow({
    center: { x: cx, y: centerY },
    radius: params.radius,
    count: params.count,
    span,
    startAngle: -span / 2 - Math.PI / 2 + Math.PI,
    seatPitch: params.seatPitch,
    elevation: params.rake,
    rowLabel: params.rowLabel,
    idPrefix: 'preview-arc',
    tier: params.tier,
    yScale: params.yScale,
    numbering: params.numbering,
  });
  const seats = stampSeatIds(raw, 'preview');
  return {
    stats: previewStats(
      seats,
      `Fila curva · ${params.count} butacas · radio ${params.radius} · arco ${params.spanDeg}°`,
    ),
    seats,
  };
}

export function previewTables(
  ctx: PlacementContext,
  params: TablesGeneratorParams,
): GeneratorPreviewResult {
  const origin = generatorPlacement(ctx);
  const seats: SeatMapSeat[] = [];
  for (let t = 0; t < params.tableCount; t++) {
    const row = Math.floor(t / params.tablesPerRow);
    const col = t % params.tablesPerRow;
    const cx = origin.x + col * params.tablePitch - ((params.tablesPerRow - 1) * params.tablePitch) / 2;
    const cy = origin.y + row * params.tablePitch;
    const radius = Math.max(28, (params.seatsPerTable * params.seatPitch) / (2 * Math.PI)) * 1.15;
    const tableSeats = generateCurvedRow({
      center: { x: cx, y: cy },
      radius,
      count: params.seatsPerTable,
      seatPitch: params.seatPitch,
      rowLabel: `M${t + 1}`,
      idPrefix: `table-${t}`,
      tier: params.tier,
      elevation: 0,
    });
    seats.push(...tableSeats);
  }
  const stamped = stampSeatIds(seats, 'preview');
  return {
    stats: previewStats(
      stamped,
      `${params.tableCount} mesas × ${params.seatsPerTable} butacas (${stamped.length.toLocaleString('es-MX')} asientos)`,
    ),
    seats: stamped,
  };
}

export function previewGaZone(ctx: PlacementContext, params: GaGeneratorParams): GeneratorPreviewResult {
  const origin = generatorPlacement(ctx);
  const points: [number, number][] = [
    [origin.x - params.width / 2, origin.y],
    [origin.x + params.width / 2, origin.y],
    [origin.x + params.width / 2, origin.y + params.height],
    [origin.x - params.width / 2, origin.y + params.height],
  ];
  const gaSection: SeatMapSection = {
    id: `preview-ga`,
    name: params.name,
    slug: `ga-${params.name.toLowerCase().replace(/\s+/g, '-')}`,
    color: '#6366f1',
    shape: { points },
    capacity: params.capacity,
    seats: [],
  };
  return {
    stats: {
      seatCount: 0,
      bounds: {
        minX: origin.x - params.width / 2,
        minY: origin.y,
        maxX: origin.x + params.width / 2,
        maxY: origin.y + params.height,
      },
      sampleLabels: [`GA · aforo ${params.capacity.toLocaleString('es-MX')}`],
      summary: `Zona GA "${params.name}" · ${params.width}×${params.height} u`,
    },
    seats: [],
    gaSection,
  };
}

export function previewTemplate(params: TemplateGeneratorParams): GeneratorPreviewResult {
  const templateMap = generateLayoutTemplate(params.template, { capacity: params.capacity });
  const seats = templateMap.sections.flatMap((s) => s.seats);
  const names = templateMap.sections.map((s) => s.name).join(', ');
  return {
    stats: previewStats(
      seats,
      `Plantilla ${params.template} · ${seats.length.toLocaleString('es-MX')} asientos · ${templateMap.sections.length} zonas (${names})`,
    ),
    seats,
    templateMap,
  };
}

export function previewRenumber(
  map: SeatMapData,
  selectedIds: ReadonlySet<string>,
  params: RenumberParams,
): GeneratorPreviewResult {
  const selected = map.sections
    .flatMap((sec) => sec.seats.map((seat) => ({ seat, sectionId: sec.id })))
    .filter(({ seat }) => selectedIds.has(seat.id));
  if (!selected.length) {
    return {
      stats: {
        seatCount: 0,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        sampleLabels: [],
        summary: 'Selecciona butacas en el mapa para renumerar.',
      },
      seats: [],
    };
  }

  const rowTolerance = 6;
  const buckets: Array<{ y: number; seats: SeatMapSeat[] }> = [];
  for (const { seat } of [...selected].sort((a, b) => a.seat.y - b.seat.y)) {
    const bucket = buckets[buckets.length - 1];
    if (bucket && Math.abs(seat.y - bucket.y) <= rowTolerance) bucket.seats.push(seat);
    else buckets.push({ y: seat.y, seats: [seat] });
  }

  const updates: Array<{ id: string; label: string; row: string }> = [];
  buckets.forEach((bucket, rowIndex) => {
    const ordered = [...bucket.seats].sort((a, b) =>
      params.direction === 'ltr' ? a.x - b.x : b.x - a.x,
    );
    const rowLabel = params.relabelRows
      ? `${params.rowPrefix}${rowLabelAt(rowIndex)}`
      : ordered[0].row ?? rowLabelAt(rowIndex);
    ordered.forEach((seat, i) => {
      const number = params.startNumber + i;
      updates.push({ id: seat.id, label: `${rowLabel}-${number}`, row: rowLabel });
    });
  });

  const sampleLabels = updates.slice(0, 6).map((u) => u.label);
  if (updates.length > 6) sampleLabels.push(`… +${updates.length - 6}`);

  return {
    stats: {
      seatCount: updates.length,
      bounds: boundsOfSeats(selected.map((s) => s.seat)),
      sampleLabels,
      summary: `Renumerar ${updates.length.toLocaleString('es-MX')} butacas seleccionadas`,
    },
    seats: [],
    renumberUpdates: updates,
  };
}

export const DEFAULT_NUMBERING: NumberingConvention = {
  rowScheme: 'latin-no-ambiguous',
  seatScheme: 'sequential',
};
