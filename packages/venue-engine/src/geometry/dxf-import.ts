import type { SeatMapData, SeatMapLevel } from '@boletera/shared';
import {
  applyCadPrimitivesToSeatMap,
  toCadReviewPrimitive,
  type CadImportStats,
  type CadReviewPrimitive,
} from './cad-import-apply';
import { decodeDxfLayer, resolveLevelToken } from './cad-level-tags';
import { CadDiagnostics, CadImportError, buildCadImportReport, type CadImportReport } from './cad-diagnostics';

export type DxfImportRole =
  | 'section'
  | 'aisle'
  | 'obstacle'
  | 'stage'
  | 'stairs'
  | 'exit'
  | 'furniture'
  | 'focus';

export type DxfImportedPrimitive = {
  id: string;
  role: DxfImportRole;
  name: string;
  layer: string;
  points: [number, number][];
  z?: number;
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
};

export type DxfImportResult = {
  primitives: DxfImportedPrimitive[];
  map: SeatMapData;
  stats: CadImportStats;
  levels?: SeatMapLevel[];
};

type DxfPair = { code: number; value: string };

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'zone'
  );
}

function classifyRole(layer: string, name = ''): DxfImportRole {
  const hay = `${layer} ${name}`.toLowerCase();
  if (/stage|escenario|sc[eè]ne/.test(hay)) return 'stage';
  if (/focus|foco|lookat|sightline/.test(hay)) return 'focus';
  if (/furn_|furniture|led|speaker|mobiliario/.test(hay)) return 'furniture';
  if (/exit|salida|egress|door|puerta/.test(hay)) return 'exit';
  if (/stair|escalera|vomitor|ramp/.test(hay)) return 'stairs';
  if (/aisle|pasillo|gangway|circulation/.test(hay)) return 'aisle';
  if (/obstacle|barrier|column|pillar|wall|obsta|muro/.test(hay)) return 'obstacle';
  return 'section';
}

/** ASCII DXF group-code pairs (code line + value line). */
export function tokenizeDxf(text: string): DxfPair[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(String(lines[i]).trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: String(lines[i + 1] ?? '').trim() });
  }
  return pairs;
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sampleCircle(cx: number, cy: number, r: number, steps = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  out.push(out[0]);
  return out;
}

function sampleArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  steps = 16,
): [number, number][] {
  let a0 = startDeg;
  let a1 = endDeg;
  // DXF arcs are CCW; if end < start, sweep past 360
  if (a1 < a0) a1 += 360;
  const span = a1 - a0;
  const n = Math.max(2, Math.ceil((Math.abs(span) / 360) * steps));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (span * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

type RawEntity = {
  type: string;
  layer: string;
  closed?: boolean;
  points: [number, number][];
  /** CIRCLE/ARC extras */
  cx?: number;
  cy?: number;
  r?: number;
  startAngle?: number;
  endAngle?: number;
  /** Elevation / Z (group code 30) */
  z?: number;
  /** TEXT entity payload (code 1) */
  text?: string;
};

function readEntityBlock(pairs: DxfPair[], start: number): { entity: RawEntity; next: number } {
  const type = pairs[start].value.toUpperCase();
  const entity: RawEntity = { type, layer: '0', points: [] };
  let i = start + 1;
  let x: number | undefined;
  let y: number | undefined;
  const isCurve = type === 'CIRCLE' || type === 'ARC';

  const flushVertex = () => {
    if (isCurve) {
      x = undefined;
      y = undefined;
      return;
    }
    if (x != null && y != null) {
      entity.points.push([x, y]);
      x = undefined;
      y = undefined;
    }
  };

  while (i < pairs.length) {
    const { code, value } = pairs[i];
    if (code === 0) break;
    if (code === 8) entity.layer = value || '0';
    if (code === 70) entity.closed = (num(value) & 1) === 1;
    if (code === 10) {
      flushVertex();
      if (isCurve) entity.cx = num(value);
      else x = num(value);
    }
    if (code === 20) {
      if (isCurve) entity.cy = num(value);
      else {
        y = num(value);
        flushVertex();
      }
    }
    if (code === 11) {
      flushVertex();
      x = num(value);
    }
    if (code === 21) {
      y = num(value);
      flushVertex();
    }
    if (code === 40) entity.r = num(value);
    if (code === 50) entity.startAngle = num(value);
    if (code === 51) entity.endAngle = num(value);
    if (code === 30) entity.z = num(value);
    if (code === 1) entity.text = value;
    i += 1;
  }

  flushVertex();
  return { entity, next: i };
}

/**
 * Extract geometry entities from the ENTITIES section of an ASCII DXF.
 * Supports LINE, LWPOLYLINE, POLYLINE+VERTEX, CIRCLE, ARC.
 */
export function parseDxfEntities(text: string, diag?: CadDiagnostics): RawEntity[] {
  const pairs = tokenizeDxf(text);
  const out: RawEntity[] = [];
  let i = 0;
  let inEntities = false;
  /** Contador de entidades vistas, para poder señalar cuál falló. */
  let seen = 0;

  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && p.value.toUpperCase() === 'SECTION') {
      const name = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.toUpperCase() : '';
      inEntities = name === 'ENTITIES';
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value.toUpperCase() === 'ENDSEC') {
      inEntities = false;
      i += 1;
      continue;
    }
    if (!inEntities || p.code !== 0) {
      i += 1;
      continue;
    }

    const type = p.value.toUpperCase();
    seen += 1;
    diag?.note(type);

    if (type === 'TEXT' || type === 'MTEXT') {
      const { entity, next } = readEntityBlock(pairs, i);
      out.push(entity);
      i = next;
      continue;
    }
    if (type === 'LINE' || type === 'LWPOLYLINE' || type === 'CIRCLE' || type === 'ARC') {
      const { entity, next } = readEntityBlock(pairs, i);
      const isCurve = type === 'CIRCLE' || type === 'ARC';

      if (type === 'CIRCLE' && entity.cx != null && entity.cy != null && entity.r != null) {
        entity.points = sampleCircle(entity.cx, entity.cy, entity.r);
        entity.closed = true;
      } else if (
        type === 'ARC' &&
        entity.cx != null &&
        entity.cy != null &&
        entity.r != null &&
        entity.startAngle != null &&
        entity.endAngle != null
      ) {
        entity.points = sampleArc(
          entity.cx,
          entity.cy,
          entity.r,
          entity.startAngle,
          entity.endAngle,
        );
      }

      if (entity.points.length >= 2) {
        // Coordenadas no finitas producirían NaN aguas abajo sin avisar.
        if (entity.points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
          diag?.skip({
            reason: 'invalid-coordinates',
            entityType: type,
            layer: entity.layer,
            index: seen - 1,
            at: entity.points[0],
          });
        } else {
          diag?.accept();
          out.push(entity);
        }
      } else {
        diag?.skip({
          reason: isCurve
            ? 'invalid-arc'
            : entity.points.length === 0
              ? 'no-points'
              : 'too-few-points',
          entityType: type,
          layer: entity.layer,
          index: seen - 1,
          at: entity.points[0],
          detail: isCurve
            ? `radio=${entity.r ?? 'ausente'} centro=(${entity.cx ?? '?'}, ${entity.cy ?? '?'})`
            : `${entity.points.length} vértice(s)`,
        });
      }
      i = next;
      continue;
    }

    if (type === 'POLYLINE') {
      const { entity, next } = readEntityBlock(pairs, i);
      i = next;
      const verts: [number, number][] = [];
      while (i < pairs.length) {
        if (pairs[i].code === 0 && pairs[i].value.toUpperCase() === 'SEQEND') {
          i += 1;
          break;
        }
        if (pairs[i].code === 0 && pairs[i].value.toUpperCase() === 'VERTEX') {
          const block = readEntityBlock(pairs, i);
          if (block.entity.points[0]) verts.push(block.entity.points[0]);
          i = block.next;
          continue;
        }
        i += 1;
      }
      entity.points = verts;
      if (entity.closed && verts.length >= 2) {
        const [fx, fy] = verts[0];
        const [lx, ly] = verts[verts.length - 1];
        if (fx !== lx || fy !== ly) entity.points = [...verts, [fx, fy]];
      }
      if (entity.points.length >= 2) {
        diag?.accept();
        out.push(entity);
      } else {
        diag?.skip({
          reason: entity.points.length === 0 ? 'no-points' : 'too-few-points',
          entityType: 'POLYLINE',
          layer: entity.layer,
          index: seen - 1,
          at: entity.points[0],
          detail: `${entity.points.length} vértice(s) tras leer VERTEX/SEQEND`,
        });
      }
      continue;
    }

    // Tipos que el motor no interpreta (BLOCK, INSERT, SPLINE, HATCH, …).
    // Se lee la capa de todos modos: saber en qué capa estaba la entidad
    // descartada es justo lo que permite localizarla en el CAD.
    if (diag) {
      let layer: string | undefined;
      for (let k = i + 1; k < pairs.length && pairs[k].code !== 0; k++) {
        if (pairs[k].code === 8) {
          layer = pairs[k].value || undefined;
          break;
        }
      }
      diag.skip({ reason: 'unsupported-type', entityType: type, layer, index: seen - 1 });
    }
    i += 1;
  }

  return out;
}

function fitPrimitives(
  primitives: DxfImportedPrimitive[],
  targetWidth = 900,
  pad = 48,
): DxfImportedPrimitive[] {
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
  }));
}

/**
 * Parse ASCII DXF into venue primitives.
 * Layer-name heuristics: aisle|pasillo, obstacle|wall, stage|escenario, stair|escalera;
 * otherwise closed polys → sections, open polylines → aisles.
 * Level tags: AISLE__L_*, EXIT__L_*, STAIRS__F_*__T_* (see cad-level-tags).
 * CAD Y-up is flipped to map Y-down (SVG-like).
 */
export function parseDxfPrimitives(
  dxfText: string,
  diag?: CadDiagnostics,
): DxfImportedPrimitive[] {
  const entities = parseDxfEntities(dxfText, diag);
  const levels = parseDxfLevelsFromEntities(entities);
  const primitives: DxfImportedPrimitive[] = [];

  entities.forEach((e, idx) => {
    if (e.type === 'TEXT' || e.type === 'MTEXT') return;
    // Skip seat-marker layers from our own exporter (circles per seat)
    if (/^seats([_\-]|$)/i.test(e.layer)) return;
    if (/^boletera_levels$/i.test(e.layer)) return;

    // Flip Y (CAD up → map down)
    let points = e.points.map(([x, y]) => [x, -y] as [number, number]);
    if (e.closed && points.length >= 3) {
      const [fx, fy] = points[0];
      const [lx, ly] = points[points.length - 1];
      if (fx !== lx || fy !== ly) points = [...points, [fx, fy]];
    }

    const { baseLayer, tags } = decodeDxfLayer(e.layer);
    const roleHint = classifyRole(baseLayer);
    let role = roleHint;
    if (roleHint === 'section') {
      const closed =
        e.closed ||
        e.type === 'CIRCLE' ||
        (points.length >= 4 &&
          Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) <
            1e-6);
      if (!closed && points.length >= 2) role = 'aisle';
    }

    // CIRCLE on EXIT/furniture/focus → point marker
    if (
      e.type === 'CIRCLE' &&
      (role === 'exit' || role === 'furniture' || role === 'focus') &&
      e.cx != null &&
      e.cy != null
    ) {
      points = [[e.cx, -e.cy]];
    }
    // Furniture from short LINE crosses: keep first point as anchor
    if (role === 'furniture' && points.length >= 2 && e.type === 'LINE') {
      points = [points[0]];
    }

    let name =
      baseLayer.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || `DXF ${idx + 1}`;
    if (role === 'focus') {
      const m = /^focus[_\s-]*(.+)$/i.exec(baseLayer);
      if (m?.[1] && !/^focus$/i.test(m[1])) {
        name = m[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      } else if (/^focus$/i.test(baseLayer)) {
        name = 'Foco';
      }
    }

    const levelId = resolveLevelToken(tags.levelId, levels ?? []);
    const fromLevelId = resolveLevelToken(tags.fromLevelId, levels ?? []);
    const toLevelId = resolveLevelToken(tags.toLevelId, levels ?? []);

    primitives.push({
      id: `dxf-${idx}-${slugify(e.layer || e.type)}`,
      role,
      name,
      layer: e.layer,
      points,
      ...(e.z != null && Number.isFinite(e.z) ? { z: e.z } : {}),
      ...(levelId ? { levelId } : {}),
      ...(fromLevelId ? { fromLevelId } : {}),
      ...(toLevelId ? { toLevelId } : {}),
    });
  });

  return fitPrimitives(primitives);
}

function parseDxfLevelsFromEntities(entities: RawEntity[]): SeatMapLevel[] | undefined {
  for (const e of entities) {
    if ((e.type !== 'TEXT' && e.type !== 'MTEXT') || !e.text) continue;
    if (!/boletera_levels/i.test(e.layer) && !e.text.trim().startsWith('[')) continue;
    try {
      const data = JSON.parse(e.text);
      if (!Array.isArray(data)) continue;
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
      if (levels.length) return levels;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Extract venue.levels catalog from DXF BOLETERA_LEVELS text (if present). */
export function parseDxfLevels(dxfText: string): SeatMapLevel[] | undefined {
  return parseDxfLevelsFromEntities(parseDxfEntities(dxfText));
}

/** Informe del último preview: entidades aceptadas y descartadas con su motivo. */
let lastDxfImportReport: CadImportReport | null = null;

/** Devuelve el informe del último `previewDxfCadImport` (avisos parciales). */
export function getLastDxfImportReport(): CadImportReport | null {
  return lastDxfImportReport;
}

export type DxfToMapOptions = {
  mode?: 'merge' | 'replace-meta';
};

export function importDxfToSeatMap(
  dxfText: string,
  base?: SeatMapData | null,
  opts?: DxfToMapOptions,
): DxfImportResult {
  const diag = new CadDiagnostics();
  const primitives = parseDxfPrimitives(dxfText, diag);
  if (!primitives.length) {
    throw new CadImportError('dxf', diag, 'El DXF no tiene geometría que el motor pueda usar.');
  }
  lastDxfImportReport = buildCadImportReport(diag);
  const levels = parseDxfLevels(dxfText);
  const { map, stats } = applyCadPrimitivesToSeatMap(primitives, base, {
    mode: opts?.mode ?? 'merge',
    sectionLabel: 'Zona DXF',
    levels,
  });
  return { primitives, map, stats, levels };
}

/** Parse DXF into editable review rows (do not merge yet). */
export function previewDxfCadImport(dxfText: string): CadReviewPrimitive[] {
  const diag = new CadDiagnostics();
  const primitives = parseDxfPrimitives(dxfText, diag);
  if (!primitives.length) {
    throw new CadImportError('dxf', diag, 'El DXF no tiene geometría que el motor pueda usar.');
  }
  lastDxfImportReport = buildCadImportReport(diag);
  return primitives.map((p) =>
    toCadReviewPrimitive({
      id: p.id,
      role: p.role,
      name: p.name,
      points: p.points,
      z: p.z,
      source: p.layer,
      levelId: p.levelId,
      fromLevelId: p.fromLevelId,
      toLevelId: p.toLevelId,
    }),
  );
}
