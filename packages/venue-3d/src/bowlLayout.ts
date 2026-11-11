import { resolveGeometry, projectTo3D } from '@boletera/venue-engine';

export type BowlSeat = {
  id: string;
  label?: string;
  section?: string;
  row?: string;
  status?: 'available' | 'held' | 'sold' | 'blocked';
  color?: string;
  price?: number;
  x?: number;
  y?: number;
  z?: number;
  levelId?: string;
  /** Authored yaw in degrees from the 2D map editor */
  rotation?: number;
  elevation?: number;
  position?: { x: number; y: number; z: number };
  rotation3d?: { x: number; y: number; z: number };
  coord3d?: { x: number; y: number; z: number; pitch?: number; roll?: number };
  visibility?: {
    blocked?: boolean;
    restrictedView?: boolean;
    premiumView?: boolean;
  };
};

export type LaidOutSeat = BowlSeat & {
  px: number;
  py: number;
  pz: number;
  rotY: number;
  rotX?: number;
  rotZ?: number;
  decorative?: boolean;
  rowIndex?: number;
  sectionIndex?: number;
};

export type SectionPlate = {
  name: string;
  color: string;
  levelId?: string;
  center: [number, number, number];
  width: number;
  depth: number;
  rotY: number;
  height: number;
};

// Paleta de respaldo (zonas sin color propio): solo tonos de los tokens Black Ticket, sobrios sobre --ink.
const SECTION_PALETTE = [
  '#C6A56D', // --gold
  '#8EAFD0', // --seat-access
  '#8EAE96', // --money-in
  '#C9847A', // --money-out
  '#A39E94', // --text-secondary
  '#E4E0D6', // --bone-pressed
  '#8E7344', // --gold-deep
];

export function sectionColor(key: string, fallbackIndex = 0) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (
    SECTION_PALETTE[h % SECTION_PALETTE.length] ??
    SECTION_PALETTE[fallbackIndex % SECTION_PALETTE.length]
  );
}

/**
 * Places every section in its own non-overlapping angular wedge of the bowl.
 * Demo / fallback only — never the default for published maps.
 */
function wedgeLayout(
  bySection: Map<string, BowlSeat[]>,
  opts?: { span?: number; sectionOrder?: string[] }
): { seats: LaidOutSeat[]; plates: SectionPlate[] } {
  const sectionKeys = opts?.sectionOrder ?? Array.from(bySection.keys());
  const laid: LaidOutSeat[] = [];
  const plates: SectionPlate[] = [];

  const totalSections = Math.max(sectionKeys.length, 1);
  const bowlSpan = opts?.span ?? Math.PI * 1.22;
  const startAngle = -bowlSpan / 2 - Math.PI / 2;
  const aisleGap = 0.045;

  sectionKeys.forEach((key, secIdx) => {
    const group = bySection.get(key);
    if (!group || !group.length) return;
    const sorted = [...group].sort((a, b) => {
      const dy = (a.y ?? 0) - (b.y ?? 0);
      if (Math.abs(dy) > 0.5) return dy;
      return (a.x ?? 0) - (b.x ?? 0);
    });

    const rows: BowlSeat[][] = [];
    let current: BowlSeat[] = [];
    let lastY: number | null = null;
    for (const seat of sorted) {
      const y = seat.y ?? 0;
      if (lastY != null && Math.abs(y - lastY) > 10) {
        rows.push(current);
        current = [];
      }
      current.push(seat);
      lastY = y;
    }
    if (current.length) rows.push(current);
    if (!rows.length) rows.push(group);

    const secSpan = bowlSpan / totalSections;
    const secStart = startAngle + secIdx * secSpan + secSpan * aisleGap;
    const secEnd = startAngle + (secIdx + 1) * secSpan - secSpan * aisleGap;
    const color = group[0]?.color || sectionColor(key, secIdx);

    const midAngle = (secStart + secEnd) / 2;
    const midR = 4.6 + (rows.length - 1) * 0.38;
    plates.push({
      name: key,
      color,
      center: [Math.cos(midAngle) * midR, 0.02 + rows.length * 0.12, Math.sin(midAngle) * midR],
      width: Math.max(1.6, rows[0]?.length ? rows[0].length * 0.32 : 2.2),
      depth: Math.max(1.2, rows.length * 0.7),
      rotY: -midAngle + Math.PI / 2,
      height: 0.08 + rows.length * 0.05,
    });

    rows.forEach((rowSeats, rowIdx) => {
      const radius = 4.35 + rowIdx * 0.78 + secIdx * 0.04;
      const height = 0.22 + rowIdx * 0.34;
      const sortedRow = [...rowSeats].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const n = Math.max(sortedRow.length, 1);

      sortedRow.forEach((seat, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = secStart + t * (secEnd - secStart);
        const authored = typeof seat.rotation === 'number' ? seat.rotation : undefined;
        const rotY =
          authored != null && Number.isFinite(authored)
            ? (authored * Math.PI) / 180
            : -angle + Math.PI / 2;
        laid.push({
          ...seat,
          color: seat.color || color,
          px: Math.cos(angle) * radius,
          py: height,
          pz: Math.sin(angle) * radius,
          rotY,
          rotX: 0,
          rotZ: 0,
          rowIndex: rowIdx,
          sectionIndex: secIdx,
        });
      });
    });
  });

  return { seats: laid, plates };
}

export function layoutSeatsInBowl(
  seats: BowlSeat[],
  opts?: { maxSeats?: number }
): {
  seats: LaidOutSeat[];
  plates: SectionPlate[];
} {
  const max = opts?.maxSeats ?? 900;
  const list = seats.slice(0, max);
  if (!list.length) {
    return { seats: buildDecorativeBowl(), plates: [] };
  }

  const bySection = new Map<string, BowlSeat[]>();
  for (const s of list) {
    const key = s.section || 'General';
    const arr = bySection.get(key) ?? [];
    arr.push(s);
    bySection.set(key, arr);
  }

  const { seats: laid, plates } = wedgeLayout(bySection);
  laid.push(...buildDecorativeBowl({ dim: true, skipInner: 2 }));
  return { seats: laid, plates };
}

function buildDecorativeBowl(opts?: { dim?: boolean; skipInner?: number }): LaidOutSeat[] {
  const out: LaidOutSeat[] = [];
  const rows = 12;
  const skip = opts?.skipInner ?? 0;
  for (let r = skip; r < rows; r++) {
    const radius = 4.35 + r * 0.78;
    const height = 0.18 + r * 0.34;
    const count = 22 + r * 5;
    const span = Math.PI * 1.22;
    const start = -span / 2 - Math.PI / 2;
    for (let i = 0; i < count; i++) {
      if (i % 9 === 0) continue;
      const t = i / (count - 1);
      const angle = start + t * span;
      out.push({
        id: `deco-${r}-${i}`,
        decorative: true,
        status: 'sold',
        color: opts?.dim ? (r % 2 === 0 ? '#1f1f23' : '#26262b') : '#3f3f46',
        px: Math.cos(angle) * radius,
        py: height,
        pz: Math.sin(angle) * radius,
        rotY: -angle + Math.PI / 2,
        rotX: 0,
        rotZ: 0,
        rowIndex: r,
      });
    }
  }
  return out;
}

function bowlsToSeatMap(
  seats: BowlSeat[],
  opts?: {
    stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
    aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
    obstacles?: {
      id: string;
      type: string;
      points: [number, number][];
      height?: number;
      levelId?: string;
    }[];
    stairs?: {
      id: string;
      kind?: string;
      points: [number, number][];
      width?: number;
      fromLevelId?: string;
      toLevelId?: string;
    }[];
    exits?: {
      id: string;
      points: [number, number][];
      width?: number;
      label?: string;
      levelId?: string;
    }[];
    furniture?: {
      id: string;
      type: string;
      x: number;
      y: number;
      rotation?: number;
      levelId?: string;
    }[];
    focusPoints?: {
      id: string;
      label?: string;
      x: number;
      y: number;
      z?: number;
      levelId?: string;
    }[];
  }
) {
  const bySection = new Map<string, BowlSeat[]>();
  for (const s of seats) {
    const key = s.section || 'General';
    const arr = bySection.get(key) ?? [];
    arr.push(s);
    bySection.set(key, arr);
  }

  const stage = opts?.stage;
  return {
    version: 3 as const,
    venue: {
      ...(stage
        ? {
            stage: {
              x: stage.x,
              y: stage.y,
              width: stage.width,
              rotation: stage.rotation,
              elevation: stage.elevation,
            },
          }
        : {}),
      aisles: opts?.aisles,
      obstacles: opts?.obstacles,
      stairs: opts?.stairs,
      exits: opts?.exits,
      furniture: opts?.furniture as
        | {
            id: string;
            type: 'led' | 'speaker' | 'door';
            x: number;
            y: number;
            rotation?: number;
            levelId?: string;
          }[]
        | undefined,
      focusPoints: opts?.focusPoints,
    },
    sections: Array.from(bySection.entries()).map(([name, group], i) => ({
      id: `sec-${i}`,
      name,
      slug: `sec-${i}`,
      color: group[0]?.color || sectionColor(name, i),
      levelId: group[0]?.levelId,
      seats: group.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        row: s.row,
        x: s.x ?? 0,
        y: s.y ?? 0,
        rotation: s.rotation,
        elevation: s.elevation,
        position: s.position,
        rotation3d: s.rotation3d,
        coord3d: s.coord3d,
        visibility: s.visibility,
        levelId: s.levelId,
      })),
    })),
  };
}

export type LayoutSceneExtras = {
  stagePose?: {
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    rotation: number;
  };
  aisles: Array<{
    id: string;
    points: [number, number, number][];
    width?: number;
    levelId?: string;
  }>;
  obstacles: Array<{
    id: string;
    type: string;
    points: [number, number, number][];
    height: number;
    levelId?: string;
  }>;
  stairs: Array<{
    id: string;
    kind: string;
    points: [number, number, number][];
    width?: number;
    fromLevelId?: string;
    toLevelId?: string;
  }>;
  exits: Array<{
    id: string;
    label?: string;
    points: [number, number, number][];
    width?: number;
    levelId?: string;
  }>;
  furniture: Array<{
    id: string;
    type: string;
    label?: string;
    position: [number, number, number];
    rotation?: number;
    levelId?: string;
  }>;
  focusPoints: Array<{
    id: string;
    label?: string;
    position: [number, number, number];
    levelId?: string;
  }>;
};

const EMPTY_EXTRAS: LayoutSceneExtras = {
  aisles: [],
  obstacles: [],
  stairs: [],
  exits: [],
  furniture: [],
  focusPoints: [],
};

/**
 * Project published venue geometry via the Venue Geometry Engine.
 * Prefer authored elevation / position / rotation3d — never invent bowl wedges.
 */
export function layoutSeatsFromPublished(
  seats: BowlSeat[],
  opts?: {
    maxSeats?: number;
    stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
    aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
    obstacles?: {
      id: string;
      type: string;
      points: [number, number][];
      height?: number;
      levelId?: string;
    }[];
    stairs?: {
      id: string;
      kind?: string;
      points: [number, number][];
      width?: number;
      fromLevelId?: string;
      toLevelId?: string;
    }[];
    exits?: {
      id: string;
      points: [number, number][];
      width?: number;
      label?: string;
      levelId?: string;
    }[];
    furniture?: {
      id: string;
      type: string;
      x: number;
      y: number;
      rotation?: number;
      levelId?: string;
    }[];
    focusPoints?: {
      id: string;
      label?: string;
      x: number;
      y: number;
      z?: number;
      levelId?: string;
    }[];
  }
): { seats: LaidOutSeat[]; plates: SectionPlate[]; stageZ: number } & LayoutSceneExtras {
  const max = opts?.maxSeats ?? 1200;
  const list = seats.slice(0, max).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (list.length < 1) {
    return { seats: [], plates: [], stageZ: -6.6, ...EMPTY_EXTRAS };
  }

  const metaById = new Map(list.map((s) => [s.id, s]));
  const scene = resolveGeometry(
    bowlsToSeatMap(list, {
      stage: opts?.stage,
      aisles: opts?.aisles,
      obstacles: opts?.obstacles,
      stairs: opts?.stairs,
      exits: opts?.exits,
      furniture: opts?.furniture,
      focusPoints: opts?.focusPoints,
    })
  );
  const projected = projectTo3D(scene, { maxSeats: max });

  const laid: LaidOutSeat[] = projected.seats.map((p) => {
    const src = metaById.get(p.id);
    return {
      ...src,
      id: p.id,
      label: p.label ?? src?.label,
      section: p.section ?? src?.section,
      row: p.row ?? src?.row,
      status: src?.status,
      color: p.color || src?.color,
      price: src?.price,
      x: src?.x,
      y: src?.y,
      z: src?.z,
      levelId: p.levelId ?? src?.levelId,
      rotation: src?.rotation,
      elevation: src?.elevation,
      visibility: p.visibility ?? src?.visibility,
      px: p.px,
      py: p.py,
      pz: p.pz,
      rotY: p.rotY,
      rotX: p.rotX,
      rotZ: p.rotZ,
      rowIndex: p.rowIndex,
      sectionIndex: p.sectionIndex,
    };
  });

  return {
    seats: laid,
    plates: projected.plates,
    stageZ: projected.stageZ,
    stagePose: projected.stage,
    aisles: projected.aisles,
    obstacles: projected.obstacles,
    stairs: projected.stairs,
    exits: projected.exits,
    furniture: projected.furniture,
    focusPoints: projected.focusPoints,
  };
}

export function layoutSeatsAuto(
  seats: BowlSeat[],
  opts?: {
    maxSeats?: number;
    /**
     * `published` — geometry engine only.
     * `bowl` — demo wedge (explicit opt-in).
     * `auto` — use authored plan coords whenever present; bowl only if no usable XY.
     */
    mode?: 'published' | 'bowl' | 'auto';
    stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
    aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
    obstacles?: {
      id: string;
      type: string;
      points: [number, number][];
      height?: number;
      levelId?: string;
    }[];
    stairs?: {
      id: string;
      kind?: string;
      points: [number, number][];
      width?: number;
      fromLevelId?: string;
      toLevelId?: string;
    }[];
    exits?: {
      id: string;
      points: [number, number][];
      width?: number;
      label?: string;
      levelId?: string;
    }[];
    furniture?: {
      id: string;
      type: string;
      x: number;
      y: number;
      rotation?: number;
      levelId?: string;
    }[];
    focusPoints?: {
      id: string;
      label?: string;
      x: number;
      y: number;
      z?: number;
      levelId?: string;
    }[];
  }
) {
  const mode = opts?.mode ?? 'auto';
  if (mode === 'bowl') return { ...layoutSeatsInBowl(seats, opts), stageZ: -6.6, ...EMPTY_EXTRAS };
  if (mode === 'published') return layoutSeatsFromPublished(seats, opts);

  // auto: never invent a wedge when the map already has plan coordinates
  const list = seats.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (list.length >= 1) return layoutSeatsFromPublished(seats, opts);
  return { ...layoutSeatsInBowl(seats, opts), stageZ: -6.6, ...EMPTY_EXTRAS };
}
