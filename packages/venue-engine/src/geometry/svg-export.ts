import type { SeatMapData } from '@boletera/shared';
import { migrateToV3 } from './migrate';
import { computeMapBounds } from '../map-utils';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function polyPoints(points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function levelAttrs(opts: { levelId?: string; fromLevelId?: string; toLevelId?: string }): string {
  const parts: string[] = [];
  if (opts.levelId) parts.push(`data-level-id="${esc(opts.levelId)}"`);
  if (opts.fromLevelId) parts.push(`data-from-level-id="${esc(opts.fromLevelId)}"`);
  if (opts.toLevelId) parts.push(`data-to-level-id="${esc(opts.toLevelId)}"`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Export SeatMapData to SVG with class/id heuristics compatible with `importSvgToSeatMap`.
 * Layers: stage, aisle, obstacle, stairs, exit, section shapes (GA), seats as circles (ignored on re-import).
 * Level tags: data-level-id / data-from-level-id / data-to-level-id (+ levels JSON in a meta group).
 */
export function exportSeatMapToSvg(input: SeatMapData | null | undefined): string {
  const map = migrateToV3(input ?? { sections: [], version: 3 });
  const bounds = computeMapBounds(map);
  const pad = 24;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const width = bounds.width + pad * 2;
  const height = bounds.height + pad * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}">`
  );
  parts.push(`<title>${esc(map.sections[0]?.name ?? 'venue')}</title>`);

  if (map.venue?.levels?.length) {
    const payload = JSON.stringify(
      map.venue.levels.map((l) => ({
        id: l.id,
        name: l.name,
        elevation: l.elevation,
        zIndex: l.zIndex,
      }))
    );
    parts.push(
      `<g id="boletera-levels" class="levels" data-role="levels" data-levels="${esc(payload)}"></g>`
    );
  }

  const stage = map.venue?.stage;
  if (stage) {
    parts.push(
      `<rect id="stage" class="stage" data-role="stage" x="${stage.x}" y="${stage.y}" width="${stage.width}" height="22" fill="#e11d48"/>`
    );
  }

  for (const aisle of map.venue?.aisles ?? []) {
    if (aisle.points.length < 2) continue;
    const sw = aisle.width ?? 24;
    parts.push(
      `<polyline id="${esc(aisle.id)}" class="aisle" data-role="aisle" data-width="${sw}"${levelAttrs({ levelId: aisle.levelId })} points="${polyPoints(aisle.points)}" fill="none" stroke="#94a3b8" stroke-width="${sw}"/>`
    );
  }

  for (const obs of map.venue?.obstacles ?? []) {
    if (obs.points.length < 3) continue;
    parts.push(
      `<polygon id="${esc(obs.id)}" class="obstacle" data-role="obstacle"${levelAttrs({ levelId: obs.levelId })} points="${polyPoints(obs.points)}" fill="#3f3f46" stroke="#a1a1aa"/>`
    );
  }

  for (const stair of map.venue?.stairs ?? []) {
    if (stair.points.length < 2) continue;
    const kind = stair.kind ?? 'stairs';
    const sw = stair.width ?? 28;
    parts.push(
      `<polyline id="${esc(stair.id)}" class="stairs ${esc(kind)}" data-role="stairs" data-name="${esc(kind)}" data-width="${sw}"${levelAttrs({ fromLevelId: stair.fromLevelId, toLevelId: stair.toLevelId })} points="${polyPoints(stair.points)}" fill="none" stroke="#fb923c" stroke-width="${sw}"/>`
    );
  }

  for (const exit of map.venue?.exits ?? []) {
    if (!exit.points.length) continue;
    const sw = exit.width ?? 32;
    const lv = levelAttrs({ levelId: exit.levelId });
    if (exit.points.length === 1) {
      const [x, y] = exit.points[0];
      parts.push(
        `<circle id="${esc(exit.id)}" class="exit" data-role="exit" data-name="${esc(exit.label ?? exit.id)}" data-width="${sw}"${lv} cx="${x}" cy="${y}" r="${Math.max(sw * 0.35, 6)}" fill="#22c55e" stroke="#14532d"/>`
      );
    } else {
      parts.push(
        `<polyline id="${esc(exit.id)}" class="exit" data-role="exit" data-name="${esc(exit.label ?? exit.id)}" data-width="${sw}"${lv} points="${polyPoints(exit.points)}" fill="none" stroke="#22c55e" stroke-width="${sw}"/>`
      );
    }
  }

  for (const sec of map.sections) {
    let shapePts = sec.shape?.points;
    if ((!shapePts || shapePts.length < 3) && sec.seats.length) {
      const xs = sec.seats.map((s) => s.x);
      const ys = sec.seats.map((s) => s.y);
      const pad = 10;
      const minX = Math.min(...xs) - pad;
      const minY = Math.min(...ys) - pad;
      const maxX = Math.max(...xs) + pad;
      const maxY = Math.max(...ys) + pad;
      shapePts = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ];
    }
    if (shapePts && shapePts.length >= 3) {
      parts.push(
        `<polygon id="${esc(sec.slug || sec.id)}" class="section" data-name="${esc(sec.name)}" data-role="section"${levelAttrs({ levelId: sec.levelId })} points="${polyPoints(shapePts)}" fill="${esc(sec.color || '#5b9fd4')}" fill-opacity="0.25" stroke="${esc(sec.color || '#5b9fd4')}"/>`
      );
    }
    for (const seat of sec.seats) {
      parts.push(
        `<circle class="seat" data-section="${esc(sec.slug || sec.id)}" cx="${seat.x}" cy="${seat.y}" r="4" fill="${esc(sec.color || '#5b9fd4')}"/>`
      );
    }
  }

  for (const f of map.venue?.focusPoints ?? []) {
    const zAttr = f.z != null && Number.isFinite(f.z) ? ` data-z="${f.z}"` : '';
    const nameAttr = f.label ? ` data-name="${esc(f.label)}"` : '';
    parts.push(
      `<circle id="${esc(f.id)}" class="focus" data-role="focus"${nameAttr}${zAttr}${levelAttrs({ levelId: f.levelId })} cx="${f.x}" cy="${f.y}" r="6" fill="#fff" stroke="#e11d48"/>`
    );
  }

  for (const furn of map.venue?.furniture ?? []) {
    parts.push(
      `<circle id="${esc(furn.id)}" class="furniture ${esc(furn.type)}" data-role="furniture" data-type="${esc(furn.type)}" data-name="${esc(furn.type)}"${levelAttrs({ levelId: furn.levelId })} cx="${furn.x}" cy="${furn.y}" r="8" fill="#0f0f12" stroke="#be123c"/>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function svgFilename(mapName = 'venue'): string {
  const safe = mapName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'venue';
  return `${safe}.svg`;
}
