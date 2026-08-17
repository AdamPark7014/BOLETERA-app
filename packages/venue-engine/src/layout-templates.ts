import type { SeatMapBlock, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import { generateBlock, generateCurvedRow, generateStraightRow } from './geometry/generators';
import { rowLabelAt, type NumberingConvention } from './geometry/numbering';

export type LayoutTemplateId = 'arena' | 'theater' | 'stadium' | 'festival';

export type TemplateOptions = {
  capacity?: number;
  sectionCount?: number;
  /** Stable id prefix so reseed can be deterministic */
  idPrefix?: string;
  /** Convención de numeración del recinto (pares/impares, letras sin I ni O, …) */
  numbering?: NumberingConvention;
};

/**
 * Reparte un aforo objetivo en una parrilla de filas × butacas.
 *
 * Las plantillas tenían filas y columnas fijas (el estadio, 5×20 y 10×6), así
 * que pedir 45.000 butacas devolvía 300: `capacity` solo recortaba, nunca
 * expandía. Aquí se deriva la parrilla del aforo, manteniendo una proporción
 * de gradería creíble (más ancha que profunda).
 */
export function gridForCapacity(
  capacity: number,
  opts: { aspect?: number; maxRows?: number; minCols?: number } = {},
): { rows: number; cols: number } {
  const aspect = opts.aspect ?? 3.2; // butacas por fila ÷ filas
  const maxRows = opts.maxRows ?? 60;
  const minCols = opts.minCols ?? 4;
  const target = Math.max(1, Math.floor(capacity));

  let rows = Math.max(1, Math.round(Math.sqrt(target / aspect)));
  rows = Math.min(rows, maxRows);
  let cols = Math.max(minCols, Math.ceil(target / rows));

  // Con aforos muy grandes se prefiere crecer en filas antes que hacer
  // graderías de 400 butacas de ancho, que no existen.
  const MAX_COLS = 80;
  if (cols > MAX_COLS) {
    cols = MAX_COLS;
    rows = Math.min(maxRows * 4, Math.ceil(target / cols));
  }
  return { rows, cols };
}

function seatId(prefix: string, sec: string, row: string, n: number) {
  return `${prefix}-${sec}-${row}-${n}`;
}

function viewportFromSections(
  sections: SeatMapSection[],
  pad = 48,
): NonNullable<SeatMapData['viewport']> {
  const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
  const ys = sections.flatMap((s) => s.seats.map((seat) => seat.y));
  if (!xs.length) return { minX: 0, minY: 0, width: 900, height: 600 };
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, width: Math.max(maxX - minX, 200), height: Math.max(maxY - minY, 200) };
}

function pack(sections: SeatMapSection[], stageCx?: number): SeatMapData {
  const viewport = viewportFromSections(sections);
  const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
  const cx =
    stageCx ??
    (xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (viewport.minX ?? 0) + viewport.width / 2);
  const stageWidth = Math.min(320, Math.max(220, viewport.width * 0.36));
  const stageY = (viewport.minY ?? 0) + 10;
  return {
    version: 3,
    sections,
    viewport,
    venue: {
      units: 'map',
      scale: 1,
      stage: {
        x: Math.round(cx - stageWidth / 2),
        y: stageY,
        width: Math.round(stageWidth),
        elevation: 40,
      },
    },
  };
}

function withIds(
  seats: SeatMapSeat[],
  prefix: string,
  slug: string,
): SeatMapSeat[] {
  return seats.map((s, i) => {
    const row = s.row ?? 'A';
    const num = Number(String(s.label).split('-').pop()) || i + 1;
    return {
      ...s,
      id: seatId(prefix, slug, row, num),
    };
  });
}

/**
 * Curved bowl facing stage at top (low Y).
 * Sections are angular wedges with clear aisle gaps so labels/colors read as zones.
 */
export function generateArenaTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'arena';
  const capacity = opts.capacity ?? 240;
  const numbering = opts.numbering;
  // Con aforos grandes se abren más cuñas en vez de estirar las existentes:
  // un anillo de 6 secciones no sostiene 45.000 butacas de forma creíble.
  const autoSections = Math.max(4, Math.min(24, Math.round(capacity / 2000)));
  const sectionCount = Math.max(2, opts.sectionCount ?? (capacity > 2000 ? autoSections : 4));
  const perSection = Math.floor(capacity / sectionCount);
  const palette = [
    { name: 'Lateral Izq', slug: 'lateral-izq', color: '#5b9fd4' },
    { name: 'Preferente', slug: 'preferente', color: '#c45c6a' },
    { name: 'Platea', slug: 'platea', color: '#c4a35a' },
    { name: 'Lateral Der', slug: 'lateral-der', color: '#5a9e78' },
    { name: 'General', slug: 'general', color: '#7a8fd4' },
    { name: 'Mezzanine', slug: 'mezzanine', color: '#b87a9a' },
  ];
  const cx = 450;
  const cy = 400;
  const span = Math.PI * 1.05;
  const start = Math.PI + (Math.PI - span) / 2;
  const aisleGap = 0.07;
  const seatPitch = 22;
  const rowPitch = 30;
  const rake = 14;

  const sections: SeatMapSection[] = [];
  for (let s = 0; s < sectionCount; s++) {
    const base = palette[s % palette.length];
    // Con más cuñas que colores en la paleta, el slug se numera: si no, dos
    // secciones comparten id y el guardado del API borra una de las dos.
    const meta =
      sectionCount > palette.length
        ? {
            name: `${base.name} ${Math.floor(s / palette.length) + 1}`,
            slug: `${base.slug}-${s + 1}`,
            color: base.color,
          }
        : base;

    const seats: SeatMapSeat[] = [];
    const secSpan = span / sectionCount;
    const a0 = start + s * secSpan + aisleGap;
    const a1 = start + (s + 1) * secSpan - aisleGap;

    // Las filas se derivan del aforo de la cuña y del arco disponible, en vez
    // de estar topadas a 8: con 8 filas un anillo nunca pasa de unos cientos.
    const arcAtMid = Math.max(0.01, (a1 - a0) * (155 + 8 * rowPitch));
    const colsAtMid = Math.max(3, Math.floor(arcAtMid / seatPitch));
    const rows = Math.max(4, Math.ceil(perSection / colsAtMid));

    let n = 0;
    for (let r = 0; r < rows && n < perSection; r++) {
      const radius = 155 + r * rowPitch;
      const arcLen = Math.max(0.01, (a1 - a0) * radius);
      const cols = Math.max(3, Math.min(Math.floor(arcLen / seatPitch), perSection - n));
      // El generador ya aplica la convención (letras sin I/O, pares e impares):
      // renumerar aquí con un contador global rompía la etiqueta de fila.
      const rowLabel = rowLabelAt(r, numbering, rows);
      const rowSeats = generateCurvedRow({
        center: { x: cx, y: cy },
        radius,
        count: cols,
        span: a1 - a0,
        startAngle: a0,
        seatPitch,
        elevation: r * rake,
        rake: 0,
        rowLabel,
        idPrefix: `${prefix}-${meta.slug}`,
        tier: r < 2 ? 'premium' : r >= rows - 2 ? 'economy' : 'standard',
        yScale: 0.78,
        numbering,
      });
      for (const seat of rowSeats) {
        if (n >= perSection) break;
        seats.push(seat);
        n += 1;
      }
    }

    sections.push({
      id: `${prefix}-sec-${meta.slug}`,
      name: meta.name,
      slug: meta.slug,
      color: meta.color,
      rake,
      seatPitch,
      rowPitch,
      curvature: 1,
      seats,
    });
  }

  return pack(sections);
}

/** Horseshoe theater — stage top, curved orchestra + balcony */
export function generateTheaterTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'theater';
  const capacity = opts.capacity ?? 180;
  const colors = { orch: '#e11d48', left: '#38bdf8', right: '#f59e0b', balc: '#22c55e' };
  const sections: SeatMapSection[] = [];
  const rake = 12;
  const seatPitch = 28;
  const rowPitch = 26;

  {
    const max = Math.floor(capacity * 0.45);
    const rows = 8;
    const cols = 14;
    const orchBlock: SeatMapBlock = {
      id: `${prefix}-orch`,
      label: 'Luneta',
      origin: { x: 180 + ((cols - 1) * seatPitch) / 2, y: 120 },
      rows,
      seatsPerRow: cols,
      seatPitch,
      rowPitch,
      rake,
      curvature: 8,
      yaw: 0,
      elevation: 0,
      startRowLabel: 'A',
      skipColumns: [6, 7],
    };
    const blockSeats = generateBlock(orchBlock);
    const seats = withIds(blockSeats.slice(0, max), prefix, 'orch').map((s, i) => ({
      ...s,
      tier: (s.row?.charCodeAt(0) ?? 65) < 68 ? 'premium' : 'standard',
      id: seatId(prefix, 'orch', s.row ?? 'A', i + 1),
    }));
    sections.push({
      id: `${prefix}-sec-orch`,
      name: 'Luneta',
      slug: 'luneta',
      color: colors.orch,
      rake,
      seatPitch,
      rowPitch,
      curvature: 8,
      blocks: [orchBlock],
      seats,
    });
  }

  for (const side of [
    { slug: 'izq', name: 'Palco Izq', color: colors.left, x0: 70, yaw: 12 },
    { slug: 'der', name: 'Palco Der', color: colors.right, x0: 680, yaw: -12 },
  ] as const) {
    const sideBlock: SeatMapBlock = {
      id: `${prefix}-${side.slug}`,
      label: side.name,
      origin: { x: side.x0 + 1.5 * 26, y: 140 },
      rows: 6,
      seatsPerRow: 4,
      seatPitch: 26,
      rowPitch: 30,
      rake: 10,
      yaw: side.yaw,
      elevation: 80,
      tier: 'premium',
    };
    const seats = withIds(generateBlock(sideBlock), prefix, side.slug);
    sections.push({
      id: `${prefix}-sec-${side.slug}`,
      name: side.name,
      slug: side.slug,
      color: side.color,
      rake: 10,
      seatPitch: 26,
      rowPitch: 30,
      blocks: [sideBlock],
      seats,
    });
  }

  {
    const balcBlock: SeatMapBlock = {
      id: `${prefix}-balc`,
      label: 'Balcón',
      origin: { x: 140 + (17 * 28) / 2, y: 360 },
      rows: 4,
      seatsPerRow: 18,
      seatPitch: 28,
      rowPitch: 28,
      rake: 16,
      elevation: 160,
      curvature: 4,
      tier: 'economy',
      skipColumns: [8, 9],
    };
    const seats = withIds(generateBlock(balcBlock), prefix, 'balc');
    sections.push({
      id: `${prefix}-sec-balc`,
      name: 'Balcón',
      slug: 'balcon',
      color: colors.balc,
      rake: 16,
      seatPitch: 28,
      rowPitch: 28,
      curvature: 4,
      blocks: [balcBlock],
      seats,
    });
  }

  return pack(sections);
}

/** Sports stadium — north/south/east/west tribunes */
export function generateStadiumTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'stadium';
  const capacity = opts.capacity ?? 320;
  const numbering = opts.numbering;
  const rake = 18;
  const seatPitch = 26;
  const rowPitch = 24;

  // El aforo se reparte 30/30/20/20 entre las cuatro tribunas y cada una deriva
  // su parrilla del aforo que le toca, en lugar de tener filas fijas.
  const shares = [0.3, 0.3, 0.2, 0.2] as const;
  const grids = shares.map((share, i) =>
    gridForCapacity(Math.round(capacity * share), {
      // Norte/Sur son anchas y poco profundas; Este/Oeste al revés.
      aspect: i < 2 ? 4.5 : 1.4,
    }),
  );

  const northWidth = grids[0].cols * seatPitch;
  const northDepth = grids[0].rows * rowPitch;
  const sideDepth = grids[2].rows * rowPitch;
  const sideWidth = grids[2].cols * seatPitch;

  // El campo se dimensiona a partir de la tribuna más ancha para que las
  // laterales no se solapen con las de fondo.
  const fieldWidth = Math.max(northWidth, 600);
  const fieldHeight = Math.max(sideDepth, 400);
  const cx = 200 + fieldWidth / 2;
  const northY = 120;
  const fieldTop = northY + northDepth + 60;
  const fieldBottom = fieldTop + fieldHeight;

  const defs = [
    {
      slug: 'norte',
      name: 'Tribuna Norte',
      color: '#22c55e',
      origin: { x: cx, y: northY },
      rows: grids[0].rows,
      cols: grids[0].cols,
      facing: 0,
      elev: 0,
    },
    {
      slug: 'sur',
      name: 'Tribuna Sur',
      color: '#e11d48',
      origin: { x: cx, y: fieldBottom + 60 },
      rows: grids[1].rows,
      cols: grids[1].cols,
      facing: 180,
      elev: 0,
    },
    {
      slug: 'este',
      name: 'Preferente Este',
      color: '#38bdf8',
      origin: { x: cx + fieldWidth / 2 + 80 + sideWidth / 2, y: fieldTop },
      rows: grids[2].rows,
      cols: grids[2].cols,
      facing: -90,
      elev: 40,
    },
    {
      slug: 'oeste',
      name: 'Preferente Oeste',
      color: '#f59e0b',
      origin: { x: cx - fieldWidth / 2 - 80 - sideWidth / 2, y: fieldTop },
      rows: grids[3].rows,
      cols: grids[3].cols,
      facing: 90,
      elev: 40,
    },
  ] as const;

  const sections: SeatMapSection[] = defs.map((d, di) => {
    // Pasillo cada 14 butacas: recorrido máximo razonable hasta salir de la fila.
    const skip = Array.from({ length: d.cols }, (_, c) => c).filter(
      (c) => c > 0 && c % 15 === 0,
    );
    const block: SeatMapBlock = {
      id: `${prefix}-${d.slug}`,
      label: d.name,
      origin: d.origin,
      rows: d.rows,
      seatsPerRow: d.cols,
      seatPitch,
      rowPitch,
      rake,
      yaw: 0,
      elevation: d.elev,
      tier: di < 2 ? 'standard' : 'premium',
      skipColumns: skip,
    };
    const seats = generateBlock({
      ...block,
      facing: d.facing,
      idPrefix: `${prefix}-${d.slug}`,
      numbering,
    }).map((s) => ({
      ...s,
      tier: di < 2 ? ((s.row?.charCodeAt(0) ?? 65) < 67 ? 'premium' : 'standard') : 'premium',
    }));
    return {
      id: `${prefix}-sec-${d.slug}`,
      name: d.name,
      slug: d.slug,
      color: d.color,
      rake,
      seatPitch,
      rowPitch,
      blocks: [block],
      seats,
    };
  });

  return pack(sections);
}

/**
 * Festival: GA pit + numbered side stands.
 */
export function generateFestivalTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'fest';
  const sections: SeatMapSection[] = [];
  const cx = 450;
  const gaCols = 10;
  const gaPitch = 28;
  const gaHalf = ((gaCols - 1) * gaPitch) / 2;
  const latCols = 5;
  const latPitch = 26;
  const latSpan = (latCols - 1) * latPitch;
  const aisle = 90;
  const rake = 10;

  {
    const seats = withIds(
      generateStraightRow({
        origin: { x: cx, y: 110 },
        count: 16,
        seatPitch: 26,
        yaw: 0,
        elevation: 0,
        rowLabel: 'V',
        idPrefix: `${prefix}-vip`,
        tier: 'premium',
      }),
      prefix,
      'vip',
    );
    sections.push({
      id: `${prefix}-sec-vip`,
      name: 'VIP Front',
      slug: 'vip',
      color: '#a67c52',
      seatPitch: 26,
      rowPitch: 28,
      rake: 0,
      seats,
    });
  }

  {
    const gaBlock: SeatMapBlock = {
      id: `${prefix}-ga`,
      label: 'Pista GA',
      origin: { x: cx, y: 160 },
      rows: 6,
      seatsPerRow: gaCols,
      seatPitch: gaPitch,
      rowPitch: 28,
      rake: 4,
      elevation: 0,
      startRowLabel: 'A',
      tier: 'standard',
    };
    const seats = withIds(generateBlock(gaBlock), prefix, 'ga').map((s, i) => ({
      ...s,
      row: 'GA',
      label: `GA-${i + 1}`,
      id: seatId(prefix, 'ga', 'P', i + 1),
    }));
    sections.push({
      id: `${prefix}-sec-ga`,
      name: 'Pista GA',
      slug: 'ga',
      color: '#9f4258',
      rake: 4,
      seatPitch: gaPitch,
      rowPitch: 28,
      blocks: [gaBlock],
      seats,
    });
  }

  const latLeftX0 = cx - gaHalf - aisle - latSpan;
  const latRightX0 = cx + gaHalf + aisle;
  for (const side of [
    { slug: 'lat-a', name: 'Lateral A', color: '#5b8fb8', x0: latLeftX0 },
    { slug: 'lat-b', name: 'Lateral B', color: '#5a8f72', x0: latRightX0 },
  ] as const) {
    const latBlock: SeatMapBlock = {
      id: `${prefix}-${side.slug}`,
      label: side.name,
      origin: { x: side.x0 + latSpan / 2, y: 140 },
      rows: 8,
      seatsPerRow: latCols,
      seatPitch: latPitch,
      rowPitch: 28,
      rake,
      elevation: 20,
      tier: 'economy',
    };
    const seats = withIds(generateBlock(latBlock), prefix, side.slug);
    sections.push({
      id: `${prefix}-sec-${side.slug}`,
      name: side.name,
      slug: side.slug,
      color: side.color,
      rake,
      seatPitch: latPitch,
      rowPitch: 28,
      blocks: [latBlock],
      seats,
    });
  }

  return pack(sections, cx);
}

export function generateLayoutTemplate(
  template: LayoutTemplateId,
  opts: TemplateOptions = {},
): SeatMapData {
  switch (template) {
    case 'theater':
      return generateTheaterTemplate(opts);
    case 'stadium':
      return generateStadiumTemplate(opts);
    case 'festival':
      return generateFestivalTemplate(opts);
    case 'arena':
    default:
      return generateArenaTemplate(opts);
  }
}

/** Heuristic: map free-text prompt → template + capacity */
export function suggestTemplateFromPrompt(prompt: string): {
  template: LayoutTemplateId;
  capacity: number;
} {
  const p = prompt.toLowerCase();
  let template: LayoutTemplateId = 'arena';
  if (/teatro|obra|ballet|ópera|opera|auditorio/.test(p)) template = 'theater';
  else if (/estadio|fútbol|futbol|partido|deport/.test(p)) template = 'stadium';
  else if (/festival|open.?air|ga|pista|outdoor/.test(p)) template = 'festival';
  else if (/arena|concierto|música|musica|show/.test(p)) template = 'arena';

  const num = prompt.match(/(\d{2,5})\s*(asientos|personas|cap)/i);
  const capacity = num ? Math.min(2000, Math.max(40, parseInt(num[1], 10))) : undefined;
  const defaults: Record<LayoutTemplateId, number> = {
    arena: 240,
    theater: 180,
    stadium: 320,
    festival: 200,
  };
  return { template, capacity: capacity ?? defaults[template] };
}
