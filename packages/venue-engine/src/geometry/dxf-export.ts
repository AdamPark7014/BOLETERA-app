import type { SeatMapData } from '@boletera/shared';
import { migrateToV3 } from './migrate';
import { encodeDxfLayer } from './cad-level-tags';

function pairs(lines: Array<string | number>): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    out.push(String(lines[i]), String(lines[i + 1]));
  }
  return out.join('\n');
}

function layerName(raw: string): string {
  return (
    raw
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 31) || '0'
  );
}

/** Map Y-down → CAD Y-up */
function toCad([x, y]: [number, number]): [number, number] {
  return [x, -y];
}

function lwpolyline(layer: string, points: [number, number][], closed: boolean): string {
  if (points.length < 2) return '';
  const cad = points.map(toCad);
  const chunks: Array<string | number> = [
    0,
    'LWPOLYLINE',
    8,
    layer,
    90,
    cad.length,
    70,
    closed ? 1 : 0,
  ];
  for (const [x, y] of cad) {
    chunks.push(10, x, 20, y);
  }
  return pairs(chunks);
}

function circle(layer: string, c: [number, number], r: number, z?: number): string {
  const [x, y] = toCad(c);
  const chunks: Array<string | number> = [0, 'CIRCLE', 8, layer, 10, x, 20, y, 40, r];
  if (z != null && Number.isFinite(z)) chunks.push(30, z);
  return pairs(chunks);
}

function text(layer: string, at: [number, number], value: string, height = 2): string {
  const [x, y] = toCad(at);
  return pairs([0, 'TEXT', 8, layer, 10, x, 20, y, 40, height, 1, value]);
}

/**
 * Export SeatMapData v3 to ASCII DXF (R12-ish entities).
 * Layers mirror import heuristics so round-trip preserves roles.
 * Level tags: AISLE__L_*, EXIT__L_*, STAIRS__F_*__T_*, SECTION_*__L_*.
 */
export function exportSeatMapToDxf(input: SeatMapData | null | undefined): string {
  const map = migrateToV3(input ?? { sections: [], version: 3 });
  const entities: string[] = [];

  if (map.venue?.levels?.length) {
    const payload = JSON.stringify(
      map.venue.levels.map((l) => ({
        id: l.id,
        name: l.name,
        elevation: l.elevation,
        zIndex: l.zIndex,
      }))
    );
    // Chunk if needed — TEXT code 1 is typically one line; keep compact.
    entities.push(text(layerName('BOLETERA_LEVELS'), [0, -40], payload.slice(0, 250), 1));
  }

  const stage = map.venue?.stage;
  if (stage) {
    const h = 20;
    const pts: [number, number][] = [
      [stage.x, stage.y],
      [stage.x + stage.width, stage.y],
      [stage.x + stage.width, stage.y + h],
      [stage.x, stage.y + h],
      [stage.x, stage.y],
    ];
    entities.push(lwpolyline(layerName('STAGE'), pts, true));
  }

  for (const aisle of map.venue?.aisles ?? []) {
    if (aisle.points.length >= 2) {
      entities.push(
        lwpolyline(encodeDxfLayer('AISLE', { levelId: aisle.levelId }), aisle.points, false)
      );
    }
  }

  for (const obs of map.venue?.obstacles ?? []) {
    if (obs.points.length >= 2) {
      entities.push(
        lwpolyline(encodeDxfLayer('OBSTACLE', { levelId: obs.levelId }), obs.points, true)
      );
    }
  }

  for (const stair of map.venue?.stairs ?? []) {
    if (stair.points.length >= 2) {
      const base =
        stair.kind === 'vomitoria'
          ? 'STAIRS_VOMITOR'
          : stair.kind === 'ramp'
            ? 'STAIRS_RAMP'
            : 'STAIRS';
      entities.push(
        lwpolyline(
          encodeDxfLayer(base, {
            fromLevelId: stair.fromLevelId,
            toLevelId: stair.toLevelId,
          }),
          stair.points,
          false
        )
      );
    }
  }

  for (const exit of map.venue?.exits ?? []) {
    if (!exit.points.length) continue;
    const layer = encodeDxfLayer('EXIT', { levelId: exit.levelId });
    if (exit.points.length === 1) {
      const [x, y] = exit.points[0];
      entities.push(circle(layer, [x, y], Math.max((exit.width ?? 32) * 0.35, 4)));
    } else {
      entities.push(lwpolyline(layer, exit.points, false));
    }
  }

  for (const sec of map.sections) {
    const secBase = `SECTION_${sec.slug || sec.name || sec.id}`;
    const secLayer = encodeDxfLayer(secBase, { levelId: sec.levelId });
    if (sec.shape?.points?.length) {
      entities.push(lwpolyline(secLayer, sec.shape.points, true));
    }
    const seatLayer = layerName(`SEATS_${sec.slug || sec.name || sec.id}`);
    const pitch = (sec.seatPitch ?? 26) * 0.18;
    for (const seat of sec.seats) {
      entities.push(circle(seatLayer, [seat.x, seat.y], Math.max(pitch, 2)));
    }
  }

  // Furniture as point markers (circle) on FURN_{type}__L_*
  for (const f of map.venue?.furniture ?? []) {
    const layer = encodeDxfLayer(`FURN_${f.type}`, { levelId: f.levelId });
    entities.push(circle(layer, [f.x, f.y], 6));
  }

  // Sightline focus points
  for (const f of map.venue?.focusPoints ?? []) {
    const base = f.label ? `FOCUS_${f.label}` : 'FOCUS';
    entities.push(circle(encodeDxfLayer(base, { levelId: f.levelId }), [f.x, f.y], 5, f.z));
  }

  const layers = [
    'STAGE',
    'AISLE',
    'OBSTACLE',
    'STAIRS',
    'STAIRS_VOMITOR',
    'STAIRS_RAMP',
    'EXIT',
    'FOCUS',
    'BOLETERA_LEVELS',
    ...((map.venue?.aisles ?? []).map((a) => encodeDxfLayer('AISLE', { levelId: a.levelId })) ??
      []),
    ...((map.venue?.obstacles ?? []).map((o) =>
      encodeDxfLayer('OBSTACLE', { levelId: o.levelId })
    ) ?? []),
    ...((map.venue?.stairs ?? []).map((s) =>
      encodeDxfLayer(
        s.kind === 'vomitoria' ? 'STAIRS_VOMITOR' : s.kind === 'ramp' ? 'STAIRS_RAMP' : 'STAIRS',
        { fromLevelId: s.fromLevelId, toLevelId: s.toLevelId }
      )
    ) ?? []),
    ...((map.venue?.exits ?? []).map((e) => encodeDxfLayer('EXIT', { levelId: e.levelId })) ?? []),
    ...((map.venue?.furniture ?? []).map((f) =>
      encodeDxfLayer(`FURN_${f.type}`, { levelId: f.levelId })
    ) ?? []),
    ...((map.venue?.focusPoints ?? []).map((f) =>
      encodeDxfLayer(f.label ? `FOCUS_${f.label}` : 'FOCUS', { levelId: f.levelId })
    ) ?? []),
    ...map.sections.flatMap((s) => [
      encodeDxfLayer(`SECTION_${s.slug || s.name || s.id}`, { levelId: s.levelId }),
      layerName(`SEATS_${s.slug || s.name || s.id}`),
    ]),
  ];

  const tableLayers: string[] = [];
  for (const name of [...new Set(layers)]) {
    tableLayers.push(pairs([0, 'LAYER', 2, name, 70, 0, 62, 7, 6, 'CONTINUOUS']));
  }

  const header = pairs([
    0,
    'SECTION',
    2,
    'HEADER',
    9,
    '$ACADVER',
    1,
    'AC1009',
    9,
    '$INSUNITS',
    70,
    0,
    0,
    'ENDSEC',
    0,
    'SECTION',
    2,
    'TABLES',
    0,
    'TABLE',
    2,
    'LAYER',
    70,
    tableLayers.length,
  ]);

  const tablesEnd = pairs([0, 'ENDTAB', 0, 'ENDSEC']);
  const ents = [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...entities.filter(Boolean),
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');

  return [header, tableLayers.join('\n'), tablesEnd, ents].filter(Boolean).join('\n');
}

/** Download helper for browser editors */
export function dxfFilename(mapName = 'venue'): string {
  const safe = mapName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'venue';
  return `${safe}.dxf`;
}
