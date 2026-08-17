import type { SeatMapData, SeatMapLevel } from '@boletera/shared';
import {
  applyCadPrimitivesToSeatMap,
  toCadReviewPrimitive,
  type CadImportStats,
  type CadReviewPrimitive,
} from './cad-import-apply';
import {
  CadDiagnostics,
  CadImportError,
  buildCadImportReport,
  type CadImportReport,
} from './cad-diagnostics';

export type SvgImportRole =
  | 'section'
  | 'aisle'
  | 'obstacle'
  | 'stage'
  | 'stairs'
  | 'exit'
  | 'furniture'
  | 'focus';

export type SvgImportedPrimitive = {
  id: string;
  role: SvgImportRole;
  name: string;
  points: [number, number][];
  color?: string;
  width?: number;
  z?: number;
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
};

export type SvgImportResult = {
  primitives: SvgImportedPrimitive[];
  map: SeatMapData;
  stats: CadImportStats;
  levels?: SeatMapLevel[];
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'zone';
}

function parseNumbers(raw: string): number[] {
  return (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);
}

function classifyRole(id: string, className: string, dataRole: string): SvgImportRole {
  const hay = `${id} ${className} ${dataRole}`.toLowerCase();
  if (/stage|escenario|sc[eè]ne/.test(hay)) return 'stage';
  if (/focus|foco|lookat|sightline/.test(hay)) return 'focus';
  if (/furniture|furn_|led|speaker|mobiliario/.test(hay)) return 'furniture';
  if (/exit|salida|egress|door|puerta/.test(hay)) return 'exit';
  if (/stair|escalera|vomitor|ramp/.test(hay)) return 'stairs';
  if (/aisle|pasillo|gangway/.test(hay)) return 'aisle';
  if (/obstacle|barrier|column|pillar|wall|obsta/.test(hay)) return 'obstacle';
  return 'section';
}

function sampleCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  steps = 6,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    out.push([x, y]);
  }
  return out;
}

/** Parse a subset of SVG path `d` into polyline points (M/L/H/V/C/Z, abs+rel). */
export function parseSvgPathD(d: string): [number, number][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let i = 0;
  let cmd = 'M';
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const readNum = () => {
    const n = Number(tokens[i++]);
    return Number.isFinite(n) ? n : 0;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      i += 1;
    }

    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === 'M' || C === 'L') {
      const x = readNum();
      const y = readNum();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      if (C === 'M') {
        startX = cx;
        startY = cy;
      }
      points.push([cx, cy]);
      // subsequent pairs after M are implicit L
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (C === 'H') {
      const x = readNum();
      cx = rel ? cx + x : x;
      points.push([cx, cy]);
      continue;
    }
    if (C === 'V') {
      const y = readNum();
      cy = rel ? cy + y : y;
      points.push([cx, cy]);
      continue;
    }
    if (C === 'C') {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      const x = readNum();
      const y = readNum();
      const X1 = rel ? cx + x1 : x1;
      const Y1 = rel ? cy + y1 : y1;
      const X2 = rel ? cx + x2 : x2;
      const Y2 = rel ? cy + y2 : y2;
      const X = rel ? cx + x : x;
      const Y = rel ? cy + y : y;
      points.push(...sampleCubic(cx, cy, X1, Y1, X2, Y2, X, Y));
      cx = X;
      cy = Y;
      continue;
    }
    if (C === 'Z') {
      points.push([startX, startY]);
      cx = startX;
      cy = startY;
      continue;
    }
    // Unsupported command — skip one number to avoid infinite loop
    i += 1;
  }

  return points;
}

function attr(el: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return unescapeXml(el.match(re)?.[1] ?? '');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseLevelsMeta(svg: string): SeatMapLevel[] | undefined {
  // Prefer dedicated levels group
  const groupRe = /<(?:g|svg)\b[^>]*data-role\s*=\s*["']levels["'][^>]*>/gi;
  const groups = svg.match(groupRe) ?? [];
  for (const el of groups) {
    const raw = attr(el, 'data-levels');
    const parsed = tryParseLevelsJson(raw);
    if (parsed?.length) return parsed;
  }
  // Fallback: any element with data-levels
  const anyRe = /data-levels\s*=\s*["']([^"']*)["']/i;
  const m = svg.match(anyRe);
  if (m) {
    return tryParseLevelsJson(unescapeXml(m[1]));
  }
  return undefined;
}

function tryParseLevelsJson(raw: string): SeatMapLevel[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return undefined;
    const levels: SeatMapLevel[] = [];
    for (const row of data) {
      if (!row || typeof row.id !== 'string') continue;
      levels.push({
        id: row.id,
        name: typeof row.name === 'string' ? row.name : row.id,
        elevation: Number(row.elevation) || 0,
        zIndex: Number(row.zIndex) || 0,
      });
    }
    return levels.length ? levels : undefined;
  } catch {
    return undefined;
  }
}

function extractElements(svg: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
  return svg.match(re) ?? [];
}

function pointsFromElement(tag: string, el: string): [number, number][] {
  if (tag === 'polygon' || tag === 'polyline') {
    const nums = parseNumbers(attr(el, 'points'));
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (tag === 'polygon' && pts.length >= 3) {
      const [fx, fy] = pts[0];
      const [lx, ly] = pts[pts.length - 1];
      if (fx !== lx || fy !== ly) pts.push([fx, fy]);
    }
    return pts;
  }
  if (tag === 'rect') {
    const x = Number(attr(el, 'x') || 0);
    const y = Number(attr(el, 'y') || 0);
    const w = Number(attr(el, 'width') || 0);
    const h = Number(attr(el, 'height') || 0);
    if (w <= 0 || h <= 0) return [];
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ];
  }
  if (tag === 'path') {
    return parseSvgPathD(attr(el, 'd'));
  }
  if (tag === 'circle') {
    const cx = Number(attr(el, 'cx'));
    const cy = Number(attr(el, 'cy'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return [];
    return [[cx, cy]];
  }
  return [];
}

function fitPrimitives(
  primitives: SvgImportedPrimitive[],
  targetWidth = 900,
  pad = 48,
): SvgImportedPrimitive[] {
  const all = primitives.flatMap((p) => p.points);
  if (!all.length) return primitives;
  const minX = Math.min(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const scale = (targetWidth - pad * 2) / Math.max(w, h);
  return primitives.map((p) => ({
    ...p,
    points: p.points.map(
      ([x, y]) =>
        [Math.round((x - minX) * scale + pad), Math.round((y - minY) * scale + pad)] as [
          number,
          number,
        ],
    ),
    width: p.width != null ? Math.max(4, Math.round(p.width * scale)) : undefined,
    // Keep elevation z unscaled (map units already authored)
    z: p.z,
  }));
}

/**
 * Parse an SVG floor-plan string into venue primitives, then merge into SeatMapData.
 * Heuristics: id/class/data-role containing aisle|obstacle|stage; otherwise section shapes (GA).
 * Level tags: data-level-id / data-from-level-id / data-to-level-id (+ data-levels JSON).
 */
export function parseSvgPrimitives(
  svgText: string,
  diag?: CadDiagnostics,
): SvgImportedPrimitive[] {
  const svg = svgText.replace(/\n+/g, ' ');
  const primitives: SvgImportedPrimitive[] = [];
  let idx = 0;

  for (const tag of ['polygon', 'polyline', 'rect', 'path', 'circle'] as const) {
    /*
     * El recorrido va por tipo de etiqueta, no en orden de documento, así que
     * el índice se lleva por etiqueta: "path #2" significa "el segundo <path>
     * del archivo", que es lo que el operador puede buscar en su editor.
     */
    let seen = 0;
    for (const el of extractElements(svg, tag)) {
      const dataRole = attr(el, 'data-role') || attr(el, 'data-boletera');
      if (dataRole === 'levels') continue;
      seen += 1;
      diag?.note(tag);

      const elementId = attr(el, 'id') || undefined;
      const points = pointsFromElement(tag, el);
      if (!points.length) {
        // Antes esto era un `continue` mudo: el elemento desaparecía sin rastro.
        diag?.skip({
          reason: tag === 'path' || tag === 'polygon' || tag === 'polyline'
            ? 'unparsable-attribute'
            : 'degenerate',
          entityType: tag,
          layer: attr(el, 'class') || undefined,
          ref: elementId,
          index: seen - 1,
          detail:
            tag === 'path'
              ? `atributo d="${attr(el, 'd').slice(0, 40)}…" sin puntos interpretables`
              : tag === 'rect'
                ? `width=${attr(el, 'width') || '0'} height=${attr(el, 'height') || '0'}`
                : undefined,
        });
        continue;
      }
      const id = elementId || `svg-${tag}-${idx}`;
      const className = attr(el, 'class');
      const fill = attr(el, 'fill');
      const role = classifyRole(id, className, dataRole);
      // Circles: exits, furniture, or focus markers; skip seat noise
      if (tag === 'circle' && role !== 'exit' && role !== 'furniture' && role !== 'focus') {
        diag?.skip({
          reason: 'unsupported-type',
          entityType: 'circle',
          layer: className || undefined,
          ref: elementId,
          index: seen - 1,
          at: points[0],
          detail:
            'los círculos solo se importan como salida, mobiliario o foco; marca su rol con data-role',
        });
        continue;
      }
      if (points.length < 2 && role !== 'exit' && role !== 'furniture' && role !== 'focus') {
        diag?.skip({
          reason: 'too-few-points',
          entityType: tag,
          layer: className || undefined,
          ref: elementId,
          index: seen - 1,
          at: points[0],
          detail: `${points.length} punto(s) para el rol "${role}"`,
        });
        continue;
      }
      diag?.accept();
      const name =
        attr(el, 'data-name') ||
        attr(el, 'data-type') ||
        id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
        `Zona ${idx + 1}`;
      const widthRaw = attr(el, 'data-width') || attr(el, 'stroke-width');
      const width = widthRaw ? Number(widthRaw) : undefined;
      const zRaw = attr(el, 'data-z');
      const z = zRaw ? Number(zRaw) : undefined;
      const levelId = attr(el, 'data-level-id') || undefined;
      const fromLevelId = attr(el, 'data-from-level-id') || undefined;
      const toLevelId = attr(el, 'data-to-level-id') || undefined;
      primitives.push({
        id: `svg-${idx}-${slugify(id)}`,
        role,
        name,
        points,
        color: fill && fill !== 'none' ? fill : undefined,
        width: width != null && Number.isFinite(width) && width > 0 ? width : undefined,
        ...(z != null && Number.isFinite(z) ? { z } : {}),
        ...(levelId ? { levelId } : {}),
        ...(fromLevelId ? { fromLevelId } : {}),
        ...(toLevelId ? { toLevelId } : {}),
      });
      idx += 1;
    }
  }

  return fitPrimitives(primitives);
}

/** Extract venue.levels catalog from SVG meta group (if present). */
export function parseSvgLevels(svgText: string): SeatMapLevel[] | undefined {
  return parseLevelsMeta(svgText.replace(/\n+/g, ' '));
}

export type SvgToMapOptions = {
  /** merge = keep existing seats; shapes-only replaces venue meta + adds empty GA sections */
  mode?: 'merge' | 'replace-meta';
};

export function importSvgToSeatMap(
  svgText: string,
  base?: SeatMapData | null,
  opts?: SvgToMapOptions,
): SvgImportResult {
  const diag = new CadDiagnostics();
  const primitives = parseSvgPrimitives(svgText, diag);
  if (!primitives.length) {
    throw new CadImportError('svg', diag, 'El SVG no tiene geometría que el motor pueda usar.');
  }
  lastSvgImportReport = buildCadImportReport(diag);
  const levels = parseSvgLevels(svgText);
  const { map, stats } = applyCadPrimitivesToSeatMap(primitives, base, {
    mode: opts?.mode ?? 'merge',
    sectionLabel: 'Zona SVG',
    levels,
  });
  return { primitives, map, stats, levels };
}

/** Informe del último preview SVG: aceptadas, descartadas y por qué. */
let lastSvgImportReport: CadImportReport | null = null;

export function getLastSvgImportReport(): CadImportReport | null {
  return lastSvgImportReport;
}

/** Parse SVG into editable review rows (do not merge yet). */
export function previewSvgCadImport(svgText: string): CadReviewPrimitive[] {
  const diag = new CadDiagnostics();
  const primitives = parseSvgPrimitives(svgText, diag);
  if (!primitives.length) {
    throw new CadImportError('svg', diag, 'El SVG no tiene geometría que el motor pueda usar.');
  }
  lastSvgImportReport = buildCadImportReport(diag);
  return primitives.map((p) =>
    toCadReviewPrimitive({
      id: p.id,
      role: p.role,
      name: p.name,
      points: p.points,
      color: p.color,
      width: p.width,
      z: p.z,
      source: p.role,
      levelId: p.levelId,
      fromLevelId: p.fromLevelId,
      toLevelId: p.toLevelId,
    }),
  );
}
