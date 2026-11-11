import type {
  SeatMapBlock,
  SeatMapData,
  SeatMapSeat,
  SeatMapSection,
  SeatMapVenueMeta,
  SeatVisibility,
} from '@boletera/shared';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseVisibility(raw: unknown): SeatVisibility | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  return {
    blocked: Boolean(o.blocked),
    restrictedView: Boolean(o.restrictedView),
    premiumView: Boolean(o.premiumView),
  };
}

function parsePosition(raw: unknown): { x: number; y: number; z: number } | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { x, y, z };
}

function parseRotation3d(raw: unknown): { x: number; y: number; z: number } | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { x, y, z };
}

function parseCoord3d(raw: unknown): SeatMapSeat['coord3d'] {
  const o = asRecord(raw);
  if (!o) return undefined;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  const pitch = o.pitch != null ? Number(o.pitch) : undefined;
  const roll = o.roll != null ? Number(o.roll) : undefined;
  return {
    x,
    y,
    z,
    ...(pitch != null && Number.isFinite(pitch) ? { pitch } : {}),
    ...(roll != null && Number.isFinite(roll) ? { roll } : {}),
  };
}

function parseBlock(raw: unknown, i: number): SeatMapBlock | null {
  const o = asRecord(raw);
  if (!o) return null;
  const origin = asRecord(o.origin);
  const ox = Number(origin?.x);
  const oy = Number(origin?.y);
  const rows = Number(o.rows);
  const seatsPerRow = Number(o.seatsPerRow);
  const seatPitch = Number(o.seatPitch);
  const rowPitch = Number(o.rowPitch);
  if (![ox, oy, rows, seatsPerRow, seatPitch, rowPitch].every(Number.isFinite)) return null;
  return {
    id: String(o.id ?? `block-${i}`),
    label: o.label != null ? String(o.label) : undefined,
    origin: { x: ox, y: oy },
    rows: Math.max(1, Math.floor(rows)),
    seatsPerRow: Math.max(1, Math.floor(seatsPerRow)),
    seatPitch,
    rowPitch,
    rake: o.rake != null ? Number(o.rake) : undefined,
    curvature: o.curvature != null ? Number(o.curvature) : undefined,
    yaw: o.yaw != null ? Number(o.yaw) : undefined,
    elevation: o.elevation != null ? Number(o.elevation) : undefined,
    startRowLabel: o.startRowLabel != null ? String(o.startRowLabel) : undefined,
    tier: o.tier != null ? String(o.tier) : undefined,
    skipColumns: Array.isArray(o.skipColumns)
      ? o.skipColumns.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : undefined,
  };
}

function hydrateSeat(
  raw: Partial<SeatMapSeat> & Record<string, unknown>,
  fallbackId: string
): SeatMapSeat {
  const coord3d = parseCoord3d(raw.coord3d);
  let position = parsePosition(raw.position);
  if (!position && coord3d) {
    position = { x: coord3d.x, y: coord3d.y, z: coord3d.z };
  }
  let rotation3d = parseRotation3d(raw.rotation3d);
  if (!rotation3d && (coord3d?.pitch != null || coord3d?.roll != null || raw.rotation != null)) {
    rotation3d = {
      x: coord3d?.pitch ?? 0,
      y: Number(raw.rotation) || 0,
      z: coord3d?.roll ?? 0,
    };
  }
  const elevation =
    raw.elevation != null && Number.isFinite(Number(raw.elevation))
      ? Number(raw.elevation)
      : position?.y;

  return {
    id: String(raw.id ?? fallbackId),
    label: String(raw.label ?? fallbackId),
    row: raw.row != null ? String(raw.row) : undefined,
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    rotation: raw.rotation != null ? Number(raw.rotation) : undefined,
    tier: raw.tier != null ? String(raw.tier) : undefined,
    coord3d,
    position,
    rotation3d,
    elevation,
    visibility: parseVisibility(raw.visibility),
    levelId: raw.levelId != null ? String(raw.levelId) : undefined,
    metadata: asRecord(raw.metadata) ?? undefined,
  };
}

function hydrateSection(
  raw: Partial<SeatMapSection> & Record<string, unknown>,
  index: number
): SeatMapSection {
  const seatsRaw = Array.isArray(raw.seats) ? raw.seats : [];
  const blocks = Array.isArray(raw.blocks)
    ? (raw.blocks.map((b, i) => parseBlock(b, i)).filter(Boolean) as SeatMapBlock[])
    : undefined;

  return {
    id: String(raw.id || raw.slug || `section-${index}`),
    name: String(raw.name || `Sección ${index + 1}`),
    slug: String(raw.slug || `sec-${index}`),
    color: String(raw.color || '#486581'),
    shape:
      raw.shape && typeof raw.shape === 'object'
        ? (raw.shape as SeatMapSection['shape'])
        : undefined,
    blocks: blocks?.length ? blocks : undefined,
    rake: raw.rake != null && Number.isFinite(Number(raw.rake)) ? Number(raw.rake) : undefined,
    seatPitch:
      raw.seatPitch != null && Number.isFinite(Number(raw.seatPitch))
        ? Number(raw.seatPitch)
        : undefined,
    rowPitch:
      raw.rowPitch != null && Number.isFinite(Number(raw.rowPitch))
        ? Number(raw.rowPitch)
        : undefined,
    curvature:
      raw.curvature != null && Number.isFinite(Number(raw.curvature))
        ? Number(raw.curvature)
        : undefined,
    levelId: raw.levelId != null ? String(raw.levelId) : undefined,
    locked: raw.locked === true ? true : undefined,
    seats: seatsRaw.map((s, j) =>
      hydrateSeat((s ?? {}) as Partial<SeatMapSeat> & Record<string, unknown>, `seat-${index}-${j}`)
    ),
  };
}

function hydrateVenue(raw: unknown): SeatMapVenueMeta | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const venue: SeatMapVenueMeta = {};
  if (o.stage && typeof o.stage === 'object') {
    const st = o.stage as Record<string, unknown>;
    venue.stage = {
      x: Number(st.x) || 0,
      y: Number(st.y) || 0,
      width: Number(st.width) || 200,
      rotation: st.rotation != null ? Number(st.rotation) : undefined,
      elevation: st.elevation != null ? Number(st.elevation) : undefined,
    };
  }
  if (Array.isArray(o.obstacles)) {
    venue.obstacles = (o.obstacles as Array<Record<string, unknown>>)
      .filter((obs) => obs && Array.isArray(obs.points))
      .map((obs, i) => ({
        id: String(obs.id ?? `obstacle-${i}`),
        type: String(obs.type ?? 'barrier'),
        points: obs.points as [number, number][],
        height:
          obs.height != null && Number.isFinite(Number(obs.height))
            ? Number(obs.height)
            : undefined,
        levelId: obs.levelId != null ? String(obs.levelId) : undefined,
      }));
  }
  if (Array.isArray(o.furniture)) {
    venue.furniture = (o.furniture as Array<Record<string, unknown>>)
      .filter((f) => f && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y)))
      .map((f, i) => {
        const typeRaw = String(f.type ?? 'led');
        const type =
          typeRaw === 'speaker' || typeRaw === 'door' || typeRaw === 'led' ? typeRaw : 'led';
        return {
          id: String(f.id ?? `furn-${i}`),
          type,
          x: Number(f.x),
          y: Number(f.y),
          rotation: f.rotation != null ? Number(f.rotation) : undefined,
          levelId: f.levelId != null ? String(f.levelId) : undefined,
        };
      });
  }
  if (Array.isArray(o.levels)) {
    venue.levels = o.levels as SeatMapVenueMeta['levels'];
  }
  if (Array.isArray(o.aisles)) {
    venue.aisles = (o.aisles as Array<Record<string, unknown>>)
      .filter((a) => a && Array.isArray(a.points))
      .map((a, i) => ({
        id: String(a.id ?? `aisle-${i}`),
        points: a.points as [number, number][],
        width: a.width != null && Number.isFinite(Number(a.width)) ? Number(a.width) : undefined,
        levelId: a.levelId != null ? String(a.levelId) : undefined,
      }));
  }
  if (Array.isArray(o.stairs)) {
    venue.stairs = (o.stairs as Array<Record<string, unknown>>)
      .filter((s) => s && Array.isArray(s.points) && (s.points as unknown[]).length >= 2)
      .map((s, i) => {
        const kindRaw = String(s.kind ?? 'stairs');
        const kind =
          kindRaw === 'vomitoria' || kindRaw === 'ramp' || kindRaw === 'stairs'
            ? kindRaw
            : 'stairs';
        return {
          id: String(s.id ?? `stair-${i}`),
          kind,
          points: s.points as [number, number][],
          width: s.width != null && Number.isFinite(Number(s.width)) ? Number(s.width) : undefined,
          fromLevelId: s.fromLevelId != null ? String(s.fromLevelId) : undefined,
          toLevelId: s.toLevelId != null ? String(s.toLevelId) : undefined,
        };
      });
  }
  if (Array.isArray(o.exits)) {
    venue.exits = (o.exits as Array<Record<string, unknown>>)
      .map((ex, i) => {
        const ptsRaw = Array.isArray(ex.points) ? ex.points : null;
        let points: [number, number][] = [];
        if (ptsRaw?.length) {
          points = ptsRaw
            .map((p) => {
              if (Array.isArray(p) && p.length >= 2)
                return [Number(p[0]), Number(p[1])] as [number, number];
              return null;
            })
            .filter(
              (p): p is [number, number] =>
                p != null && Number.isFinite(p[0]) && Number.isFinite(p[1])
            );
        } else if (Number.isFinite(Number(ex.x)) && Number.isFinite(Number(ex.y))) {
          points = [[Number(ex.x), Number(ex.y)]];
        }
        if (!points.length) return null;
        return {
          id: String(ex.id ?? `exit-${i}`),
          points,
          label: ex.label != null ? String(ex.label) : undefined,
          width:
            ex.width != null && Number.isFinite(Number(ex.width)) ? Number(ex.width) : undefined,
          levelId: ex.levelId != null ? String(ex.levelId) : undefined,
        };
      })
      .filter((ex): ex is NonNullable<typeof ex> => ex != null);
  }
  if (o.units === 'map' || o.units === 'meters') venue.units = o.units;
  if (o.scale != null && Number.isFinite(Number(o.scale))) venue.scale = Number(o.scale);
  if (o.snapPitch != null && Number.isFinite(Number(o.snapPitch)))
    venue.snapPitch = Number(o.snapPitch);
  if (o.cadLocks && typeof o.cadLocks === 'object') {
    const c = o.cadLocks as Record<string, unknown>;
    venue.cadLocks = {
      aisles: c.aisles === true ? true : undefined,
      obstacles: c.obstacles === true ? true : undefined,
      stairs: c.stairs === true ? true : undefined,
      stage: c.stage === true ? true : undefined,
      furniture: c.furniture === true ? true : undefined,
      exits: c.exits === true ? true : undefined,
      focusPoints: c.focusPoints === true ? true : undefined,
      strictOverlaps: c.strictOverlaps === true ? true : undefined,
    };
  }
  if (Array.isArray(o.focusPoints)) {
    venue.focusPoints = (o.focusPoints as Array<Record<string, unknown>>)
      .filter((f) => f && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y)))
      .map((f, i) => ({
        id: String(f.id ?? `focus-${i}`),
        label: f.label != null ? String(f.label) : undefined,
        x: Number(f.x),
        y: Number(f.y),
        z: f.z != null && Number.isFinite(Number(f.z)) ? Number(f.z) : undefined,
        levelId: f.levelId != null ? String(f.levelId) : undefined,
      }));
  }
  if (o.egressPolicy && typeof o.egressPolicy === 'object') {
    const p = o.egressPolicy as Record<string, unknown>;
    const num = (k: string) =>
      p[k] != null && Number.isFinite(Number(p[k])) ? Number(p[k]) : undefined;
    venue.egressPolicy = {
      longPathUnits: num('longPathUnits'),
      slowClearanceMinutes: num('slowClearanceMinutes'),
      bottleneckUtilization: num('bottleneckUtilization'),
      bottleneckSeatLoad: num('bottleneckSeatLoad'),
    };
  }
  return venue;
}

/**
 * Migrate any SeatMapData (v1/v2/partial) into a v3-shaped document without
 * inventing new seats. Downstream resolve fills missing poses.
 */
export function migrateToV3(raw: unknown): SeatMapData {
  const input = asRecord(raw) ?? {};
  const sectionsIn = Array.isArray(input.sections) ? input.sections : [];
  const sections = sectionsIn.map((sec, i) =>
    hydrateSection((sec ?? {}) as Partial<SeatMapSection> & Record<string, unknown>, i)
  );

  const viewportIn = asRecord(input.viewport);
  const venue = hydrateVenue(input.venue);

  return {
    version: 3,
    sections,
    viewport: viewportIn
      ? {
          width: Number(viewportIn.width) || 800,
          height: Number(viewportIn.height) || 500,
          minX: viewportIn.minX != null ? Number(viewportIn.minX) : undefined,
          minY: viewportIn.minY != null ? Number(viewportIn.minY) : undefined,
        }
      : undefined,
    venue,
  };
}
