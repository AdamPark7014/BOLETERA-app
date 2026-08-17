'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SeatMapData,
  SeatMapFocusPoint,
  SeatMapFurniture,
  SeatMapLevel,
  SeatMapSeat,
  SeatMapSection,
} from '@boletera/shared';
import {
  generateBlock,
  generateCurvedRow,
  generateStraightRow,
  applySightlinesToScene,
  analyzeCirculation,
  calculateSightlines,
  defaultSeatPitchMap,
  defaultRowPitchMap,
  fillShapeWithSeats,
  previewDxfCadImport,
  previewSvgCadImport,
  parseDxfLevels,
  parseSvgLevels,
  commitCadImportReview,
  CAD_ENTITY_ROLES,
  CAD_ROLE_LABELS,
  enforceCadLocksOnReview,
  isCadRoleLocked,
  activeCadLockLabels,
  exportSeatMapToDxf,
  exportSeatMapToSvg,
  dxfFilename,
  svgFilename,
  regenerateSeatsFromBlocks,
  resolveGeometry,
  snapPoint,
  validateGeometry,
  buildEgressReport,
  exportEgressReportToCsv,
  egressReportFilename,
  resolveEgressPolicy,
  pathPointsForSection,
  buildEgressPathOverlays,
  filterCirculationGraph,
  removeVenueLevel,
  patchVenueLevel,
  buildSeatIndex,
  SEAT_FLAG,
  lodModeFor,
  querySeatsInRect,
  hitTestSeat,
  seatsOfSection,
  applySeatProps,
  applySeatSection,
  pushCommand,
  undo as undoCommand,
  redo as redoCommand,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  EMPTY_HISTORY,
  estimateMapBytes,
  formatBytes,
  auditAccessibility,
  generateAccessibleSpaces,
  requiredWheelchairSpaces,
  type HistoryState,
  type EditCommand,
  type CadReviewPrimitive,
  type CadEntityRole,
} from '@boletera/venue-engine';
import { SeatCanvasLayer } from './SeatMap/SeatCanvasLayer';
import styles from './SeatMapEditor.module.scss';

/** Selección vacía compartida: evita crear un Set nuevo en cada limpieza. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

type CadReviewState = {
  source: 'svg' | 'dxf';
  filename: string;
  rows: CadReviewPrimitive[];
  mode: 'merge' | 'replace-meta';
  levels?: SeatMapLevel[];
};

type Props = {
  initial: SeatMapData;
  onSave: (map: SeatMapData) => Promise<void>;
  onApplyTemplate?: (template: 'arena' | 'theater' | 'stadium' | 'festival') => Promise<SeatMapData>;
  onAiSuggest?: (description: string) => Promise<SeatMapData | SeatMapSection[]>;
  /** Enables server egress report (GET saved / POST draft) */
  venueId?: string;
  getAuthToken?: () => string | null;
};

const TIERS = ['standard', 'premium', 'economy'] as const;
const TEMPLATES = [
  { id: 'arena' as const, label: 'Arena' },
  { id: 'theater' as const, label: 'Teatro' },
  { id: 'stadium' as const, label: 'Estadio' },
  { id: 'festival' as const, label: 'Festival' },
];

type Point = { x: number; y: number };

type DragState =
  | { mode: 'pan'; startX: number; startY: number; panTx: number; panTy: number }
  | {
      mode: 'seat';
      seatIds: string[];
      startX: number;
      startY: number;
      orig: Record<string, Point>;
    }
  | {
      mode: 'section';
      sectionId: string;
      startX: number;
      startY: number;
      origSeats: Record<string, Point>;
      origShape?: [number, number][];
      origBlocks?: Record<string, Point>;
    }
  | {
      mode: 'stage';
      startX: number;
      startY: number;
      orig: { x: number; y: number; width: number };
    }
  | {
      mode: 'stage-resize';
      side: 'left' | 'right';
      startX: number;
      startY: number;
      orig: { x: number; width: number };
    }
  | { mode: 'furniture'; id: string; startX: number; startY: number; orig: Point }
  | {
      mode: 'focus';
      id: string;
      startX: number;
      startY: number;
      orig: Point;
    }
  | {
      mode: 'block';
      sectionId: string;
      blockId: string;
      startX: number;
      startY: number;
      origOrigin: Point;
    };

function cloneMap(m: SeatMapData): SeatMapData {
  return JSON.parse(JSON.stringify(m)) as SeatMapData;
}

/** Andrew's monotone chain convex hull, CCW order. */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

function padOutward(hull: Point[], pad: number): Point[] {
  if (hull.length < 3) return hull;
  const cx = hull.reduce((n, p) => n + p.x, 0) / hull.length;
  const cy = hull.reduce((n, p) => n + p.y, 0) / hull.length;
  return hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

/** Backdrop outline for a section: hand-drawn shape if present, else a padded hull/box around its seats. */
function sectionBackdropPoints(section: SeatMapSection): Point[] {
  if (section.shape?.points && section.shape.points.length >= 3) {
    return section.shape.points.map(([x, y]) => ({ x, y }));
  }
  if (!section.seats.length) return [];
  if (section.seats.length < 3) {
    const xs = section.seats.map((s) => s.x);
    const ys = section.seats.map((s) => s.y);
    const minX = Math.min(...xs) - 16;
    const maxX = Math.max(...xs) + 16;
    const minY = Math.min(...ys) - 16;
    const maxY = Math.max(...ys) + 16;
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }
  return padOutward(convexHull(section.seats.map((s) => ({ x: s.x, y: s.y }))), 18);
}

function FurnitureGlyph({
  item,
  selected,
  onPointerDown,
}: {
  item: SeatMapFurniture;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  if (item.type === 'led') {
    return (
      <g transform={`translate(${item.x} ${item.y})`} onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <rect
          x={-26}
          y={-8}
          width={52}
          height={16}
          rx={2}
          fill="#1a0510"
          stroke={selected ? '#fff' : '#be123c'}
          strokeWidth={selected ? 2 : 1}
        />
        <rect x={-22} y={-5} width={44} height={10} rx={1} fill="#be123c" opacity={0.55} />
      </g>
    );
  }
  if (item.type === 'speaker') {
    return (
      <g transform={`translate(${item.x} ${item.y})`} onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <rect
          x={-7}
          y={-10}
          width={14}
          height={20}
          rx={2}
          fill="#0f0f12"
          stroke={selected ? '#fff' : '#404040'}
          strokeWidth={selected ? 2 : 1}
        />
        <circle cx={0} cy={-4} r={3.4} fill="#27272a" />
        <circle cx={0} cy={5} r={2.4} fill="#27272a" />
      </g>
    );
  }
  return (
    <g transform={`translate(${item.x} ${item.y})`} onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
      <rect
        x={-9}
        y={-13}
        width={18}
        height={26}
        rx={2}
        fill="#18181b"
        stroke={selected ? '#fff' : '#52525b'}
        strokeWidth={selected ? 2 : 1}
      />
    </g>
  );
}

export function SeatMapEditor({
  initial,
  onSave,
  onApplyTemplate,
  onAiSuggest,
  venueId,
  getAuthToken,
}: Props) {
  const [map, setMap] = useState<SeatMapData>(() => cloneMap(initial));
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    initial.sections[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Arena 400 asientos, 4 secciones, escenario al norte');
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(40);
  const [ty, setTy] = useState(40);
  const [tool, setTool] = useState<
    'select' | 'pan' | 'ga' | 'move-section' | 'aisle' | 'obstacle' | 'stairs' | 'focus' | 'exit'
  >('select');
  const [gaDraft, setGaDraft] = useState<Point[]>([]);
  const [polyDraft, setPolyDraft] = useState<Point[]>([]);
  const [blockParams, setBlockParams] = useState({
    rows: 5,
    cols: 12,
    seatPitch: 26,
    rowPitch: 28,
    rake: 12,
    curvature: 0,
    /** Comma-separated indices, or `every:N` for pasillo periódico */
    skipColumns: 'every:8',
  });
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [viewHeat, setViewHeat] = useState(false);
  const [showCirculation, setShowCirculation] = useState(false);
  const [cadReview, setCadReview] = useState<CadReviewState | null>(null);
  /**
   * Historial por comandos. Antes eran 40 clones profundos del documento; a
   * 45.000 butacas eso son cientos de megabytes y un bloqueo por acción. Ahora
   * cada comando guarda solo lo que cambia, y las instantáneas completas (que
   * siguen haciendo falta para plantillas o importaciones) están topadas aparte.
   */
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const dragRef = useRef<DragState | null>(null);
  /** Origen del rectángulo de selección en curso. */
  const marqueeRef = useRef<{ x0: number; y0: number; additive: boolean } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    setMap(cloneMap(initial));
    setActiveSectionId(initial.sections[0]?.id ?? null);
    setHistory(EMPTY_HISTORY);
  }, [initial]);

  /** Mide el viewport para que el canvas recorte con el tamaño real. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewportSize({ width: Math.round(r.width), height: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Registra un comando compacto y aplica el mapa resultante. */
  const commit = useCallback((next: SeatMapData, command: EditCommand) => {
    setHistory((h) => pushCommand(h, command));
    setMap(next);
  }, []);

  /**
   * Cambio estructural: se guarda instantánea completa porque no hay inverso
   * compacto (plantillas, importación CAD, regeneración de bloques).
   */
  const pushHistory = useCallback(
    (next: SeatMapData, label = 'Cambio de estructura') => {
      const before = mapRef.current;
      setHistory((h) => pushCommand(h, { kind: 'snapshot', label, before, after: next }));
      setMap(next);
    },
    [],
  );

  function undo() {
    const result = undoCommand(mapRef.current, history);
    if (result.history === history) return;
    setMap(result.map);
    setHistory(result.history);
    setSelected(EMPTY_SELECTION);
  }

  function redo() {
    const result = redoCommand(mapRef.current, history);
    if (result.history === history) return;
    setMap(result.map);
    setHistory(result.history);
    setSelected(EMPTY_SELECTION);
  }

  const activeSection = map.sections.find((s) => s.id === activeSectionId) ?? map.sections[0];

  useEffect(() => {
    const block = activeSection?.blocks?.[0];
    if (!block) return;
    setBlockParams({
      rows: block.rows,
      cols: block.seatsPerRow,
      seatPitch: block.seatPitch,
      rowPitch: block.rowPitch,
      rake: block.rake ?? 0,
      curvature: block.curvature ?? 0,
      skipColumns: (block.skipColumns ?? []).join(','),
    });
  }, [activeSection?.id, activeSection?.blocks?.[0]?.id]);

  function parseSkipColumns(raw: string, cols: number): number[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // "every:8" → columns 8,16,... (legacy insert behavior)
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

  /**
   * Índice espacial columnar: arrays tipados + rejilla. Se reconstruye solo
   * cuando cambia la geometría, no al seleccionar ni al hacer zoom.
   */
  const seatIndex = useMemo(() => buildSeatIndex(map), [map]);
  const seatCount = seatIndex.count;

  /** A partir de este tamaño se apagan los análisis caros en cada tecla. */
  const isLargeVenue = seatCount > 5000;

  /**
   * `allSeats` se conserva para las herramientas CAD que aún lo usan, pero solo
   * se materializa en recintos pequeños: a 45.000 butacas crear ese array en
   * cada render es justo lo que había que quitar.
   */
  const allSeats = useMemo(
    () =>
      isLargeVenue
        ? []
        : map.sections.flatMap((sec) =>
            sec.seats.map((s) => ({ ...s, sectionId: sec.id, sectionColor: sec.color })),
          ),
    [map.sections, isLargeVenue],
  );

  /** Selección traducida a índices internos: comparación O(1) en el canvas. */
  const selectedIdx = useMemo(() => {
    const set = new Set<number>();
    for (const id of selected) {
      const i = seatIndex.idToIdx.get(id);
      if (i !== undefined) set.add(i);
    }
    return set;
  }, [selected, seatIndex]);

  /** Nivel de detalle actual, para explicarlo en la barra de estado. */
  const lodLabel = useMemo(() => {
    const mode = lodModeFor(scale);
    if (mode === 'seats') return 'butacas';
    if (mode === 'clusters') return 'densidad (acércate para ver butacas)';
    return 'zonas (acércate para ver butacas)';
  }, [scale]);

  const firstSelectedSeat = useMemo(() => {
    for (const id of selected) {
      const i = seatIndex.idToIdx.get(id);
      if (i === undefined) continue;
      const sec = map.sections[seatIndex.sectionIdx[i]];
      return sec?.seats.find((s) => s.id === id);
    }
    return undefined;
  }, [selected, seatIndex, map.sections]);

  /**
   * Los límites salen del índice (ya recorrió las butacas una vez) más la
   * geometría autorada. `Math.min(...array)` sobre 45.000 elementos además
   * desborda la pila de argumentos, así que se acumula en un bucle.
   */
  const bounds = useMemo(() => {
    let minX = seatIndex.count ? seatIndex.bounds.minX : Infinity;
    let minY = seatIndex.count ? seatIndex.bounds.minY : Infinity;
    let maxX = seatIndex.count ? seatIndex.bounds.maxX : -Infinity;
    let maxY = seatIndex.count ? seatIndex.bounds.maxY : -Infinity;

    const extend = (px: number, py: number) => {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    };

    for (const sec of map.sections) {
      if (sec.shape?.points) for (const [px, py] of sec.shape.points) extend(px, py);
    }
    if (map.venue?.stage) {
      extend(map.venue.stage.x, map.venue.stage.y);
      extend(map.venue.stage.x + map.venue.stage.width, map.venue.stage.y);
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: 900, height: 600 };
    const pad = 80;
    return {
      minX: minX - pad,
      minY: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
  }, [seatIndex, map.sections, map.venue]);

  const stage = useMemo(
    () =>
      map.venue?.stage ?? {
        x: bounds.minX + bounds.width * 0.28,
        y: bounds.minY - 36,
        width: bounds.width * 0.44,
      },
    [map.venue, bounds],
  );
  const furniture = map.venue?.furniture ?? [];
  const aisles = map.venue?.aisles ?? [];
  const obstacles = map.venue?.obstacles ?? [];
  const stairs = map.venue?.stairs ?? [];
  const exits = map.venue?.exits ?? [];
  const snapPitch = map.venue?.snapPitch ?? defaultSeatPitchMap(map.venue?.scale ?? 40);
  const mapScale = map.venue?.scale ?? 40;

  /**
   * `resolveGeometry` + `validateGeometry` + `analyzeCirculation` recorren todo
   * el recinto. Ejecutarlos de forma síncrona en cada cambio del mapa —que es lo
   * que hacía el editor— convierte cada tecla en medio segundo de bloqueo a
   * 45.000 butacas. Se difieren: el mapa se dibuja ya y el análisis alcanza
   * después. El guardado fuerza un pase completo antes de enviar.
   */
  const [deferredMap, setDeferredMap] = useState(map);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!isLargeVenue) {
      setDeferredMap(map);
      return;
    }
    setAnalyzing(true);
    const id = window.setTimeout(() => {
      setDeferredMap(map);
      setAnalyzing(false);
    }, 350);
    return () => window.clearTimeout(id);
  }, [map, isLargeVenue]);

  /** Auditoría de accesibilidad — se recalcula con el mapa diferido, no en caliente. */
  const accessibility = useMemo(() => auditAccessibility(deferredMap), [deferredMap]);

  const resolvedScene = useMemo(() => resolveGeometry(deferredMap), [deferredMap]);
  /** Level-scoped issues for banner / canvas highlights. */
  const validation = useMemo(
    () =>
      validateGeometry(resolvedScene, {
        levelId: levelFilter === 'ALL' ? undefined : levelFilter,
      }),
    [resolvedScene, levelFilter],
  );
  const overlapSeatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of validation.issues) {
      if (issue.code === 'overlap') for (const id of issue.seatIds) ids.add(id);
    }
    return ids;
  }, [validation.issues]);

  /** Solapamientos como índices internos, para que el canvas no busque por id. */
  const overlapSeatIdx = useMemo(() => {
    const set = new Set<number>();
    for (const id of overlapSeatIds) {
      const i = seatIndex.idToIdx.get(id);
      if (i !== undefined) set.add(i);
    }
    return set;
  }, [overlapSeatIds, seatIndex]);

  const sightlineBySeat = useMemo(() => {
    if (!viewHeat || !seatCount) return null;
    const result = calculateSightlines(resolveGeometry(deferredMap), {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    return new Map(result.scores.map((s) => [s.seatId, s]));
  }, [viewHeat, deferredMap, seatCount, levelFilter]);

  /** Puntuaciones de visibilidad en array paralelo al índice (sin Map en el bucle). */
  const sightlineScores = useMemo(() => {
    if (!sightlineBySeat) return null;
    const arr = new Float32Array(seatIndex.count);
    for (let i = 0; i < seatIndex.count; i++) {
      arr[i] = sightlineBySeat.get(seatIndex.ids[i])?.score ?? 0;
    }
    return arr;
  }, [sightlineBySeat, seatIndex]);

  const circulationScene = useMemo(() => {
    if (!showCirculation) return null;
    return resolveGeometry(map);
  }, [showCirculation, map]);

  const circulation = useMemo(() => {
    if (!circulationScene) return null;
    return analyzeCirculation(circulationScene);
  }, [circulationScene]);

  const activeEgressPath = useMemo(() => {
    if (!circulation || !activeSection) return null;
    if (
      levelFilter !== 'ALL' &&
      activeSection.levelId &&
      activeSection.levelId !== levelFilter
    ) {
      return null;
    }
    const resolved = pathPointsForSection(circulation, activeSection.id);
    if (!resolved) return null;
    return {
      points: resolved.points.map(([x, y]) => ({ x, y })),
      length: resolved.pathLength,
    };
  }, [circulation, activeSection, levelFilter]);

  const egressOverlay = useMemo(() => {
    if (!circulationScene || !circulation) return null;
    return buildEgressPathOverlays(circulationScene, {
      analysis: circulation,
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [circulationScene, circulation, levelFilter]);

  const circulationGraphView = useMemo(() => {
    if (!circulation) return null;
    return filterCirculationGraph(
      circulation.graph,
      levelFilter === 'ALL' ? undefined : levelFilter,
    );
  }, [circulation, levelFilter]);

  const bottlenecksView = useMemo(() => {
    if (!circulation?.egress?.bottlenecks?.length) return [];
    if (levelFilter === 'ALL' || !circulationGraphView) {
      return circulation.egress.bottlenecks;
    }
    const edgeIds = new Set(circulationGraphView.edges.map((e) => e.id));
    return circulation.egress.bottlenecks.filter((b) => edgeIds.has(b.edgeId));
  }, [circulation, circulationGraphView, levelFilter]);

  const bottleneckEdgeIds = useMemo(() => {
    if (!bottlenecksView.length) return new Set<string>();
    return new Set(bottlenecksView.slice(0, 3).map((b) => b.edgeId));
  }, [bottlenecksView]);

  /**
   * Lleva la vista a las butacas o la zona de un aviso y las deja seleccionadas.
   *
   * Sin esto, un mensaje como «las butacas A-12 y A-13 se pisan» obligaba a
   * buscarlas a mano en un recinto de 45.000 plazas: el aviso era informativo,
   * no accionable.
   */
  const focusOnEntities = useCallback(
    (seatIds: string[] | undefined, sectionIds: string[] | undefined) => {
      const idx = seatIndex;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      const targetSeats = (seatIds ?? []).filter((id) => idx.idToIdx.has(id));
      if (targetSeats.length) {
        for (const id of targetSeats) {
          const i = idx.idToIdx.get(id)!;
          minX = Math.min(minX, idx.x[i]);
          minY = Math.min(minY, idx.y[i]);
          maxX = Math.max(maxX, idx.x[i]);
          maxY = Math.max(maxY, idx.y[i]);
        }
        setSelected(new Set(targetSeats));
      } else if (sectionIds?.length) {
        for (const secId of sectionIds) {
          const sec = map.sections.find((s) => s.id === secId);
          if (!sec) continue;
          for (const seat of sec.seats) {
            minX = Math.min(minX, seat.x);
            minY = Math.min(minY, seat.y);
            maxX = Math.max(maxX, seat.x);
            maxY = Math.max(maxY, seat.y);
          }
        }
        setSelected(EMPTY_SELECTION);
      }

      const firstSection = sectionIds?.[0] ?? (targetSeats.length
        ? idx.sections[idx.sectionIdx[idx.idToIdx.get(targetSeats[0])!]]?.id
        : undefined);
      if (firstSection) setActiveSectionId(firstSection);

      if (!Number.isFinite(minX)) return;

      // Margen suficiente para ver el contexto de la butaca, no solo el punto.
      const pad = Math.max(idx.pitch * 6, 60);
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      const next = Math.max(0.15, Math.min(6, Math.min(viewportSize.width / w, viewportSize.height / h)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setScale(next);
      setTx(viewportSize.width / 2 - cx * next);
      setTy(viewportSize.height / 2 - cy * next);
    },
    [seatIndex, map.sections, viewportSize],
  );

  /**
   * Avisos accionables: geometría + accesibilidad en una sola lista, con los
   * errores primero. La accesibilidad no salía en el panel de validación, así que
   * un mapa sin plazas de silla de ruedas se publicaba sin que nadie lo viera.
   */
  const actionableIssues = useMemo(() => {
    type Row = {
      severity: 'error' | 'warning';
      message: string;
      hint?: string;
      seatIds?: string[];
      sectionIds?: string[];
    };
    const rows: Row[] = validation.issues.map((i) => ({
      severity: i.severity === 'error' ? 'error' : 'warning',
      message: i.message,
      hint: i.hint,
      seatIds: i.seatIds,
      sectionIds: i.sectionIds,
    }));

    if (accessibility.capacity > 0) {
      if (accessibility.wheelchairSpaces < accessibility.requiredWheelchairSpaces) {
        rows.push({
          severity: 'error',
          message: `Faltan ${accessibility.requiredWheelchairSpaces - accessibility.wheelchairSpaces} plazas de silla de ruedas (hay ${accessibility.wheelchairSpaces} de ${accessibility.requiredWheelchairSpaces} exigidas para ${accessibility.capacity.toLocaleString('es-MX')} butacas).`,
          hint: 'Usa «Generar plazas accesibles» en la zona activa, o marca butacas existentes con ♿ Silla.',
        });
      }
      for (const seatId of accessibility.wheelchairWithoutCompanion.slice(0, 10)) {
        rows.push({
          severity: 'warning',
          message: `La plaza accesible ${seatId} no tiene acompañante ligado.`,
          hint: 'Marca la butaca contigua como acompañante para que se vendan juntas.',
          seatIds: [seatId],
        });
      }
      for (const seatId of accessibility.orphanCompanions.slice(0, 10)) {
        rows.push({
          severity: 'error',
          message: `El acompañante ${seatId} apunta a una plaza que ya no existe.`,
          hint: 'Vuelve a ligarlo a una plaza de silla de ruedas o quítale la marca.',
          seatIds: [seatId],
        });
      }
      for (const sec of accessibility.sectionsWithoutAccessible.slice(0, 6)) {
        rows.push({
          severity: 'warning',
          message: `La zona ${sec.name} (${sec.seats.toLocaleString('es-MX')} butacas) no tiene ninguna plaza accesible.`,
          sectionIds: [sec.id],
        });
      }
    }

    return rows.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  }, [validation.issues, accessibility]);

  const errorCount = actionableIssues.filter((i) => i.severity === 'error').length;

  const unreachableSectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of validation.issues) {
      if (issue.code === 'unreachable_section') {
        for (const id of issue.sectionIds ?? []) ids.add(id);
      }
    }
    return ids;
  }, [validation.issues]);

  const visibleSections = useMemo(() => {
    if (levelFilter === 'ALL') return map.sections;
    return map.sections.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [map.sections, levelFilter]);

  /*
   * `visibleSeatIds` desapareció: lo consumía el bucle SVG de butacas para
   * filtrar por nivel, y construía un Set con las 45.000 ids en cada render.
   * El canvas filtra ahora con el índice de nivel del propio índice espacial.
   */

  const egressSectionsView = useMemo(() => {
    if (!circulation?.egress?.sections) return [];
    if (levelFilter === 'ALL') return circulation.egress.sections;
    const levelBySec = new Map(map.sections.map((s) => [s.id, s.levelId]));
    return circulation.egress.sections.filter((s) => {
      const lid = levelBySec.get(s.sectionId);
      return !lid || lid === levelFilter;
    });
  }, [circulation, levelFilter, map.sections]);

  const unreachableOnLevelCount = useMemo(() => {
    if (levelFilter === 'ALL') return unreachableSectionIds.size;
    let n = 0;
    for (const sec of visibleSections) {
      if (unreachableSectionIds.has(sec.id)) n += 1;
    }
    return n;
  }, [levelFilter, visibleSections, unreachableSectionIds]);

  function updateSections(sections: SeatMapSection[], commit = true) {
    const next = { ...map, sections, viewport: { ...map.viewport, ...bounds } };
    if (commit) pushHistory(next);
    else setMap(next);
  }

  function updateVenueMeta(patch: Partial<NonNullable<SeatMapData['venue']>>, commit = true) {
    const next = { ...map, venue: { ...map.venue, ...patch } };
    if (commit) pushHistory(next);
    else setMap(next);
  }

  const cadLocks = map.venue?.cadLocks ?? {};

  function patchCadLocks(patch: Partial<NonNullable<SeatMapData['venue']>['cadLocks']>) {
    updateVenueMeta({ cadLocks: { ...cadLocks, ...patch } });
  }

  function sectionLocked(sectionId: string | null | undefined) {
    if (!sectionId) return false;
    return Boolean(map.sections.find((s) => s.id === sectionId)?.locked);
  }

  function warnLocked(msg: string) {
    // eslint-disable-next-line no-alert
    window.alert(msg);
  }

  function exportDxf() {
    const text = exportSeatMapToDxf(map);
    const blob = new Blob([text], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dxfFilename(map.sections[0]?.name ?? 'venue');
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSvg() {
    const text = exportSeatMapToSvg(map);
    const blob = new Blob([text], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = svgFilename(map.sections[0]?.name ?? 'venue');
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportEgressCsv() {
    const report = buildEgressReport(map, { venueName: map.sections[0]?.name ?? 'venue' });
    const text = exportEgressReportToCsv(report);
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = egressReportFilename(report.venueName);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportEgressCsvFromServer(mode: 'saved' | 'draft') {
    if (!venueId) return;
    const token = getAuthToken?.() ?? localStorage.getItem('boletera_token');
    if (!token) {
      // eslint-disable-next-line no-alert
      window.alert('No hay sesión para exportar desde el servidor.');
      return;
    }
    try {
      const { analyzeVenueEgress, downloadVenueEgressCsv } = await import('@/lib/platform-api');
      if (mode === 'saved') {
        await downloadVenueEgressCsv(token, venueId);
        return;
      }
      const csv = await analyzeVenueEgress(token, venueId, { mapData: map, format: 'csv' });
      if (typeof csv !== 'string') throw new Error('Respuesta CSV inválida');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = egressReportFilename(map.sections[0]?.name ?? venueId);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(e instanceof Error ? e.message : 'Error al exportar egress');
    }
  }

  async function exportEgressPdfFromServer(mode: 'saved' | 'draft') {
    if (!venueId) return;
    const token = getAuthToken?.() ?? localStorage.getItem('boletera_token');
    if (!token) {
      // eslint-disable-next-line no-alert
      window.alert('No hay sesión para exportar PDF.');
      return;
    }
    try {
      const { downloadVenueEgressPdf, downloadVenueEgressPdfDraft } = await import(
        '@/lib/platform-api'
      );
      if (mode === 'saved') await downloadVenueEgressPdf(token, venueId);
      else await downloadVenueEgressPdfDraft(token, venueId, map);
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(e instanceof Error ? e.message : 'Error al exportar PDF');
    }
  }

  function patchEgressPolicy(
    patch: Partial<NonNullable<SeatMapData['venue']>['egressPolicy']>,
  ) {
    const current = resolveEgressPolicy(map.venue?.egressPolicy);
    updateVenueMeta({
      egressPolicy: { ...current, ...patch },
    });
  }

  function regenerateActiveFromBlocks() {
    if (!activeSection?.blocks?.length) {
      // eslint-disable-next-line no-alert
      window.alert('La sección activa no tiene bloques paramétricos.');
      return;
    }
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const next = regenerateSeatsFromBlocks(map, { sectionId: activeSection.id });
    pushHistory(next);
    setSelected(EMPTY_SELECTION);
  }

  function regenerateAllFromBlocks() {
    const any = map.sections.some((s) => s.blocks?.length && !s.locked);
    if (!any) {
      // eslint-disable-next-line no-alert
      window.alert('No hay secciones con bloques desbloqueados.');
      return;
    }
    let next = map;
    for (const sec of map.sections) {
      if (!sec.blocks?.length || sec.locked) continue;
      next = regenerateSeatsFromBlocks(next, { sectionId: sec.id });
    }
    pushHistory(next);
    setSelected(EMPTY_SELECTION);
  }

  function seedStageFocuses() {
    if (cadLocks.focusPoints) {
      warnLocked('Los focos están bloqueados (CAD lock).');
      return;
    }
    const elev = stage.elevation ?? 40;
    const y = stage.y + 10;
    const w = stage.width;
    const levelStamp = levelFilter !== 'ALL' ? { levelId: levelFilter } : {};
    updateVenueMeta({
      focusPoints: [
        { id: 'focus-l', label: 'Izq', x: stage.x + w * 0.2, y, z: elev, ...levelStamp },
        { id: 'focus-c', label: 'Centro', x: stage.x + w * 0.5, y, z: elev, ...levelStamp },
        { id: 'focus-r', label: 'Der', x: stage.x + w * 0.8, y, z: elev, ...levelStamp },
      ],
    });
    setViewHeat(true);
  }

  function clearFocuses() {
    if (cadLocks.focusPoints) {
      warnLocked('Los focos están bloqueados (CAD lock).');
      return;
    }
    updateVenueMeta({ focusPoints: undefined });
  }

  function addFocusAt(world: Point) {
    if (cadLocks.focusPoints) {
      warnLocked('Los focos están bloqueados (CAD lock).');
      return;
    }
    const elev = stage.elevation ?? 40;
    const idx = (map.venue?.focusPoints?.length ?? 0) + 1;
    const id = `focus-${Date.now()}`;
    updateVenueMeta({
      focusPoints: [
        ...(map.venue?.focusPoints ?? []),
        {
          id,
          label: `Foco ${idx}`,
          x: Math.round(world.x),
          y: Math.round(world.y),
          z: elev,
          ...(levelFilter !== 'ALL' ? { levelId: levelFilter } : {}),
        },
      ],
    });
    setViewHeat(true);
  }

  function removeFocus(id: string) {
    if (cadLocks.focusPoints) {
      warnLocked('Los focos están bloqueados (CAD lock).');
      return;
    }
    const next = (map.venue?.focusPoints ?? []).filter((f) => f.id !== id);
    updateVenueMeta({ focusPoints: next.length ? next : undefined });
  }

  function patchFocus(id: string, patch: Partial<SeatMapFocusPoint>) {
    if (cadLocks.focusPoints) return;
    updateVenueMeta({
      focusPoints: (map.venue?.focusPoints ?? []).map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    });
  }

  function addExitAt(world: Point) {
    if (cadLocks.exits) {
      window.alert('Las salidas están bloqueadas (CAD lock).');
      return;
    }
    const idx = exits.length + 1;
    const id = `exit-${Date.now()}`;
    updateVenueMeta({
      exits: [
        ...exits,
        {
          id,
          label: `Salida ${idx}`,
          points: [[Math.round(world.x), Math.round(world.y)]],
          width: 32,
          ...(levelFilter !== 'ALL' ? { levelId: levelFilter } : {}),
        },
      ],
    });
    setShowCirculation(true);
  }

  function removeExit(id: string) {
    if (cadLocks.exits) {
      window.alert('Las salidas están bloqueadas (CAD lock).');
      return;
    }
    const next = exits.filter((e) => e.id !== id);
    updateVenueMeta({ exits: next.length ? next : undefined });
  }

  function patchExit(id: string, patch: Partial<(typeof exits)[0]>) {
    if (cadLocks.exits) return;
    updateVenueMeta({
      exits: exits.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  function patchStair(id: string, patch: Partial<(typeof stairs)[0]>) {
    if (cadLocks.stairs) return;
    updateVenueMeta({
      stairs: stairs.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  function patchAisle(id: string, patch: Partial<(typeof aisles)[0]>) {
    if (cadLocks.aisles) return;
    updateVenueMeta({
      aisles: aisles.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }

  function removeAisle(id: string) {
    if (cadLocks.aisles) {
      warnLocked('Los pasillos están bloqueados (CAD lock).');
      return;
    }
    const next = aisles.filter((a) => a.id !== id);
    updateVenueMeta({ aisles: next.length ? next : undefined });
  }

  function removeStair(id: string) {
    if (cadLocks.stairs) {
      warnLocked('Las escaleras están bloqueadas (CAD lock).');
      return;
    }
    const next = stairs.filter((s) => s.id !== id);
    updateVenueMeta({ stairs: next.length ? next : undefined });
  }

  function patchObstacle(id: string, patch: Partial<(typeof obstacles)[0]>) {
    if (cadLocks.obstacles) return;
    updateVenueMeta({
      obstacles: obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  }

  function removeObstacle(id: string) {
    if (cadLocks.obstacles) {
      warnLocked('Los obstáculos están bloqueados (CAD lock).');
      return;
    }
    const next = obstacles.filter((o) => o.id !== id);
    updateVenueMeta({ obstacles: next.length ? next : undefined });
  }

  function renameFocus(id: string, label: string) {
    patchFocus(id, { label });
  }

  function addSection() {
    const idx = map.sections.length;
    const id = `tmp-sec-${Date.now()}`;
    const sec: SeatMapSection = {
      id,
      name: `Sección ${String.fromCharCode(65 + idx)}`,
      slug: `sec-${idx}`,
      color: '#e11d48',
      seats: [],
    };
    updateSections([...map.sections, sec]);
    setActiveSectionId(id);
  }

  function renameSection(id: string, name: string) {
    updateSections(map.sections.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  function deleteSection(id: string) {
    if (sectionLocked(id)) {
      warnLocked('La sección está bloqueada.');
      return;
    }
    const next = map.sections.filter((s) => s.id !== id);
    updateSections(next);
    setActiveSectionId(next[0]?.id ?? null);
    setSelected(EMPTY_SELECTION);
  }

  function addRow(cols = blockParams.cols) {
    if (!activeSection) return;
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const rowLabel = String.fromCharCode(65 + Math.floor(activeSection.seats.length / Math.max(cols, 1)));
    const startY =
      (activeSection.seats.length
        ? Math.max(...activeSection.seats.map((s) => s.y))
        : 120) + (activeSection.rowPitch ?? blockParams.rowPitch);
    const startX = activeSection.seats.length
      ? Math.min(...activeSection.seats.map((s) => s.x)) +
        ((cols - 1) * (activeSection.seatPitch ?? blockParams.seatPitch)) / 2
      : 80 + ((cols - 1) * blockParams.seatPitch) / 2;
    const elev =
      (activeSection.seats.length
        ? Math.max(...activeSection.seats.map((s) => s.elevation ?? 0))
        : 0) + (activeSection.rake ?? blockParams.rake);
    const generated = generateStraightRow({
      origin: { x: startX, y: startY },
      count: cols,
      seatPitch: activeSection.seatPitch ?? blockParams.seatPitch,
      yaw: 0,
      elevation: elev,
      rowLabel,
      idPrefix: `tmp-row-${Date.now()}`,
      tier: 'standard',
    });
    const newSeats = generated.map((s, i) => ({ ...s, id: `tmp-seat-${Date.now()}-${i}` }));
    updateSections(
      map.sections.map((s) =>
        s.id === activeSection.id
          ? {
              ...s,
              seatPitch: s.seatPitch ?? blockParams.seatPitch,
              rowPitch: s.rowPitch ?? blockParams.rowPitch,
              rake: s.rake ?? blockParams.rake,
              seats: [...s.seats, ...newSeats],
            }
          : s,
      ),
    );
  }

  function addGrid(rows = blockParams.rows, cols = blockParams.cols) {
    if (!activeSection) return;
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const baseY =
      (activeSection.seats.length ? Math.max(...activeSection.seats.map((s) => s.y)) : 100) + 40;
    const baseX = 80 + ((cols - 1) * blockParams.seatPitch) / 2;
    const skip = parseSkipColumns(blockParams.skipColumns || 'every:8', cols);
    const blockId = `tmp-block-${Date.now()}`;
    const elevation =
      activeSection.seats.length
        ? Math.max(...activeSection.seats.map((s) => s.elevation ?? 0)) + blockParams.rake
        : 0;
    const block = {
      id: blockId,
      label: `Bloque ${rows}×${cols}`,
      origin: { x: baseX, y: baseY },
      rows,
      seatsPerRow: cols,
      seatPitch: blockParams.seatPitch,
      rowPitch: blockParams.rowPitch,
      rake: blockParams.rake,
      curvature: blockParams.curvature,
      elevation,
      tier: 'standard' as const,
      skipColumns: skip,
    };
    const generated = generateBlock(block);
    const newSeats = generated.map((s, i) => ({ ...s, id: `tmp-seat-${Date.now()}-${i}` }));
    updateSections(
      map.sections.map((s) =>
        s.id === activeSection.id
          ? {
              ...s,
              seatPitch: blockParams.seatPitch,
              rowPitch: blockParams.rowPitch,
              rake: blockParams.rake,
              curvature: blockParams.curvature,
              blocks: [...(s.blocks ?? []), block],
              seats: [...s.seats, ...newSeats],
            }
          : s,
      ),
    );
  }

  function applyParamsToActiveBlocks() {
    if (!activeSection?.blocks?.length) {
      // eslint-disable-next-line no-alert
      window.alert('La sección activa no tiene bloques. Usa «Insertar bloque» primero.');
      return;
    }
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const cols = Math.max(1, Math.floor(blockParams.cols));
    const rows = Math.max(1, Math.floor(blockParams.rows));
    const skip = parseSkipColumns(blockParams.skipColumns, cols);
    const patched = {
      ...map,
      sections: map.sections.map((s) => {
        if (s.id !== activeSection.id || !s.blocks?.length) return s;
        return {
          ...s,
          seatPitch: blockParams.seatPitch,
          rowPitch: blockParams.rowPitch,
          rake: blockParams.rake,
          curvature: blockParams.curvature,
          blocks: s.blocks.map((b) => ({
            ...b,
            rows,
            seatsPerRow: cols,
            seatPitch: blockParams.seatPitch,
            rowPitch: blockParams.rowPitch,
            rake: blockParams.rake,
            curvature: blockParams.curvature,
            skipColumns: skip,
          })),
        };
      }),
    };
    const next = regenerateSeatsFromBlocks(patched, { sectionId: activeSection.id });
    pushHistory(next);
    setSelected(EMPTY_SELECTION);
  }

  function rotateActiveBlocks(deltaDeg: number) {
    if (!activeSection?.blocks?.length) return;
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const patched = {
      ...map,
      sections: map.sections.map((s) => {
        if (s.id !== activeSection.id || !s.blocks?.length) return s;
        return {
          ...s,
          blocks: s.blocks.map((b) => ({
            ...b,
            yaw: (b.yaw ?? 0) + deltaDeg,
          })),
        };
      }),
    };
    const next = regenerateSeatsFromBlocks(patched, { sectionId: activeSection.id });
    pushHistory(next);
    setSelected(EMPTY_SELECTION);
  }

  function handleBlockPointerDown(
    e: React.PointerEvent,
    sectionId: string,
    blockId: string,
    origin: Point,
  ) {
    if (tool !== 'select') return;
    if (sectionLocked(sectionId)) {
      warnLocked('La sección está bloqueada.');
      return;
    }
    e.stopPropagation();
    const world = clientToWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'block',
      sectionId,
      blockId,
      startX: world.x,
      startY: world.y,
      origOrigin: { x: origin.x, y: origin.y },
    };
    setActiveSectionId(sectionId);
    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
  }

  /** Fan-shaped curved row (theater/arena style), stacking outward on repeated calls. */
  function addCurvedRow(count = 14, spanDeg = 46) {
    if (!activeSection) return;
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const rowKeyOf = (s: SeatMapSeat) => s.row || s.label.split('-')[0] || 'A';
    const usedRowKeys = new Set(activeSection.seats.map(rowKeyOf));
    let rowIdx = usedRowKeys.size;
    let rowLabel = String.fromCharCode(65 + rowIdx);
    while (usedRowKeys.has(rowLabel)) {
      rowIdx += 1;
      rowLabel = String.fromCharCode(65 + rowIdx);
    }
    const radius = 200 + rowIdx * (activeSection.rowPitch ?? blockParams.rowPitch);
    const cx = activeSection.seats.length
      ? activeSection.seats.reduce((n, s) => n + s.x, 0) / activeSection.seats.length
      : 400;
    const anchorY = activeSection.seats.length
      ? Math.min(...activeSection.seats.map((s) => s.y))
      : 160;
    const centerY = anchorY - radius + 40;
    const elev = rowIdx * (activeSection.rake ?? blockParams.rake);
    const generated = generateCurvedRow({
      center: { x: cx, y: centerY },
      radius,
      count,
      span: (spanDeg * Math.PI) / 180,
      startAngle: -((spanDeg * Math.PI) / 180) / 2 - Math.PI / 2 + Math.PI,
      seatPitch: activeSection.seatPitch ?? blockParams.seatPitch,
      elevation: elev,
      rowLabel,
      idPrefix: `tmp-arc-${Date.now()}`,
      tier: 'standard',
      yScale: 1,
    });
    // Keep facing consistent with previous editor (angleDeg as rotation)
    const newSeats = generated.map((s, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const angleDeg = -spanDeg / 2 + t * spanDeg;
      return {
        ...s,
        id: `tmp-seat-${Date.now()}-${i}`,
        x: Math.round(cx + radius * Math.sin((angleDeg * Math.PI) / 180)),
        y: Math.round(centerY + radius * Math.cos((angleDeg * Math.PI) / 180)),
        rotation: Math.round(angleDeg),
        rotation3d: { x: 0, y: angleDeg, z: 0 },
        position: {
          x: cx + radius * Math.sin((angleDeg * Math.PI) / 180),
          y: elev,
          z: centerY + radius * Math.cos((angleDeg * Math.PI) / 180),
        },
      };
    });
    updateSections(
      map.sections.map((s) =>
        s.id === activeSection.id
          ? {
              ...s,
              rake: s.rake ?? blockParams.rake,
              seatPitch: s.seatPitch ?? blockParams.seatPitch,
              seats: [...s.seats, ...newSeats],
            }
          : s,
      ),
    );
  }

  function applyElevationToSelected(elevation: number) {
    if (!selected.size) return;
    updateSections(
      map.sections.map((sec) => ({
        ...sec,
        seats: sec.seats.map((seat) => {
          if (!selected.has(seat.id)) return seat;
          return {
            ...seat,
            elevation,
            position: { x: seat.x, y: elevation, z: seat.y },
            coord3d: {
              x: seat.x,
              y: elevation,
              z: seat.y,
              pitch: seat.rotation3d?.x ?? seat.coord3d?.pitch,
              roll: seat.rotation3d?.z ?? seat.coord3d?.roll,
            },
          };
        }),
      })),
    );
  }

  function applyVisibilityToSelected(patch: {
    blocked?: boolean;
    restrictedView?: boolean;
    premiumView?: boolean;
  }) {
    if (!selected.size) return;
    updateSections(
      map.sections.map((sec) => ({
        ...sec,
        seats: sec.seats.map((seat) => {
          if (!selected.has(seat.id)) return seat;
          return {
            ...seat,
            visibility: { ...seat.visibility, ...patch },
          };
        }),
      })),
    );
  }

  function finishPolyTool() {
    if (polyDraft.length < 2) return;
    if (tool === 'aisle' && cadLocks.aisles) {
      warnLocked('Capa de pasillos bloqueada.');
      return;
    }
    if (tool === 'obstacle' && cadLocks.obstacles) {
      warnLocked('Capa de obstáculos bloqueada.');
      return;
    }
    if (tool === 'stairs' && cadLocks.stairs) {
      warnLocked('Capa de escaleras bloqueada.');
      return;
    }
    const id = `tmp-poly-${Date.now()}`;
    const points = polyDraft.map((p) => [p.x, p.y] as [number, number]);
    if (tool === 'aisle') {
      updateVenueMeta({
        aisles: [
          ...aisles,
          {
            id,
            points,
            width: 24,
            ...(levelFilter !== 'ALL' ? { levelId: levelFilter } : {}),
          },
        ],
      });
    } else if (tool === 'obstacle') {
      updateVenueMeta({
        obstacles: [
          ...obstacles,
          {
            id,
            type: 'barrier',
            points,
            height: 120,
            ...(levelFilter !== 'ALL' ? { levelId: levelFilter } : {}),
          },
        ],
      });
    } else if (tool === 'stairs') {
      const levels = map.venue?.levels ?? [];
      const fromLevelId = levelFilter !== 'ALL' ? levelFilter : levels[0]?.id;
      let toLevelId: string | undefined;
      if (fromLevelId && levels.length) {
        const sorted = [...levels].sort((a, b) => a.zIndex - b.zIndex);
        const i = sorted.findIndex((l) => l.id === fromLevelId);
        toLevelId = (sorted[i + 1] ?? sorted[i - 1] ?? sorted.find((l) => l.id !== fromLevelId))?.id;
      }
      updateVenueMeta({
        stairs: [
          ...stairs,
          {
            id,
            kind: 'stairs',
            points,
            width: 28,
            ...(fromLevelId ? { fromLevelId } : {}),
            ...(toLevelId ? { toLevelId } : {}),
          },
        ],
      });
    }
    setPolyDraft([]);
    setTool('select');
  }

  function cancelPolyTool() {
    setPolyDraft([]);
    setTool('select');
  }

  function applySightlines() {
    const levelId = levelFilter === 'ALL' ? undefined : levelFilter;
    const { scene, result } = applySightlinesToScene(resolveGeometry(map), { levelId });
    const scoredIds = new Set(result.scores.map((s) => s.seatId));
    const byId = new Map(scene.seats.map((s) => [s.id, s]));
    const next: SeatMapData = {
      ...map,
      version: 3,
      sections: map.sections.map((sec) => ({
        ...sec,
        seats: sec.seats.map((seat) => {
          if (!scoredIds.has(seat.id)) return seat;
          const resolved = byId.get(seat.id);
          if (!resolved) return seat;
          return {
            ...seat,
            visibility: resolved.visibility,
            metadata: resolved.metadata,
          };
        }),
      })),
    };
    pushHistory(next);
    return result;
  }

  function addLevel() {
    const levels = map.venue?.levels ?? [];
    const idx = levels.length;
    const id = `level-${Date.now()}`;
    updateVenueMeta({
      levels: [
        ...levels,
        {
          id,
          name: idx === 0 ? 'Platea' : idx === 1 ? 'Balcón' : `Nivel ${idx + 1}`,
          elevation: idx * 160,
          zIndex: idx,
        },
      ],
    });
  }

  function updateLevel(
    levelId: string,
    patch: Partial<{ name: string; elevation: number; zIndex: number }>,
  ) {
    pushHistory(patchVenueLevel(map, levelId, patch));
  }

  function deleteLevel(levelId: string) {
    const lv = (map.venue?.levels ?? []).find((l) => l.id === levelId);
    if (!lv) return;
    const ok = window.confirm(
      `¿Eliminar nivel «${lv.name}»?\nSe quitará de secciones, pasillos, salidas y escaleras.`,
    );
    if (!ok) return;
    const next = removeVenueLevel(map, levelId);
    pushHistory(next);
    if (levelFilter === levelId) setLevelFilter('ALL');
  }

  function assignSectionLevel(levelId: string | undefined) {
    if (!activeSection) return;
    updateSections(
      map.sections.map((s) => (s.id === activeSection.id ? { ...s, levelId } : s)),
    );
  }

  function fillActiveShape() {
    if (!activeSection?.shape?.points?.length) return;
    if (activeSection.locked) {
      warnLocked('La sección activa está bloqueada.');
      return;
    }
    const pitch = activeSection.seatPitch ?? blockParams.seatPitch;
    const rowPitch = activeSection.rowPitch ?? blockParams.rowPitch;
    const filled = fillShapeWithSeats({
      shape: activeSection.shape,
      seatPitch: pitch,
      rowPitch,
      rake: activeSection.rake ?? blockParams.rake,
      elevation: 0,
      idPrefix: `fill-${activeSection.slug}-${Date.now()}`,
      tier: 'standard',
    });
    if (!filled.length) {
      // eslint-disable-next-line no-alert
      window.alert('No cupieron asientos en el contorno con el pitch actual.');
      return;
    }
    updateSections(
      map.sections.map((s) =>
        s.id === activeSection.id
          ? {
              ...s,
              seatPitch: pitch,
              rowPitch,
              rake: s.rake ?? blockParams.rake,
              seats: [...s.seats, ...filled],
            }
          : s,
      ),
    );
  }

  function applyMetricDefaults() {
    const seatPitch = defaultSeatPitchMap(mapScale);
    const rowPitch = defaultRowPitchMap(mapScale);
    setBlockParams((p) => ({ ...p, seatPitch, rowPitch }));
    updateVenueMeta({
      units: 'map',
      scale: mapScale || 40,
      snapPitch: seatPitch,
    });
  }

  function importSvgFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        const rows = previewSvgCadImport(text);
        if (!rows.length) {
          window.alert('SVG sin geometría usable.');
          return;
        }
        const locks = map.venue?.cadLocks;
        const enforced = enforceCadLocksOnReview(rows, locks);
        setCadReview({
          source: 'svg',
          filename: file.name,
          rows: enforced.rows,
          mode: 'merge',
          levels: parseSvgLevels(text),
        });
        if (enforced.lockedCount > 0) {
          const labels = activeCadLockLabels(locks).join(', ');
          window.alert(
            `${enforced.lockedCount} entidad(es) omitidas por CAD lock (${labels || 'capas bloqueadas'}).`,
          );
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'No se pudo leer el SVG');
      }
    };
    reader.readAsText(file);
  }

  function importDxfFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        const rows = previewDxfCadImport(text);
        const locks = map.venue?.cadLocks;
        const enforced = enforceCadLocksOnReview(rows, locks);
        setCadReview({
          source: 'dxf',
          filename: file.name,
          rows: enforced.rows,
          mode: 'merge',
          levels: parseDxfLevels(text),
        });
        if (enforced.lockedCount > 0) {
          const labels = activeCadLockLabels(locks).join(', ');
          window.alert(
            `${enforced.lockedCount} entidad(es) omitidas por CAD lock (${labels || 'capas bloqueadas'}).`,
          );
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'No se pudo leer el DXF');
      }
    };
    reader.readAsText(file);
  }

  function patchCadReviewRole(id: string, role: CadEntityRole) {
    if (role !== 'skip' && isCadRoleLocked(role, map.venue?.cadLocks)) {
      warnLocked(`Rol «${CAD_ROLE_LABELS[role]}» bloqueado (CAD lock).`);
      return;
    }
    setCadReview((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, role } : r)) }
        : prev,
    );
  }

  function setAllCadReviewRole(role: CadEntityRole) {
    setCadReview((prev) => {
      if (!prev) return prev;
      const next = prev.rows.map((r) => ({ ...r, role }));
      const { rows } = enforceCadLocksOnReview(next, map.venue?.cadLocks);
      return { ...prev, rows };
    });
  }

  function resetCadReviewRoles() {
    setCadReview((prev) => {
      if (!prev) return prev;
      const restored = prev.rows.map((r) => ({ ...r, role: r.suggestedRole as CadEntityRole }));
      const { rows } = enforceCadLocksOnReview(restored, map.venue?.cadLocks);
      return { ...prev, rows };
    });
  }

  function applyCadReview() {
    if (!cadReview) return;
    try {
      const locks = map.venue?.cadLocks;
      const { rows: safeRows } = enforceCadLocksOnReview(cadReview.rows, locks);
      const { map: next, stats } = commitCadImportReview(safeRows, map, {
        mode: cadReview.mode,
        sectionLabel: cadReview.source === 'dxf' ? 'Zona DXF' : 'Zona SVG',
        levels: cadReview.levels,
        cadLocks: locks,
      });
      pushHistory(next);
      setCadReview(null);
      window.alert(
        `${cadReview.source.toUpperCase()} aplicado (${cadReview.filename})\n` +
          `Secciones: ${stats.sections}\nPasillos: ${stats.aisles}\nObstáculos: ${stats.obstacles}\n` +
          `Escaleras: ${stats.stairs}\nSalidas: ${stats.exits}\nMobiliario: ${stats.furniture}\n` +
          `Focos: ${stats.focuses}\n` +
          `Omitidos: ${stats.skipped}` +
          (stats.lockedSkipped ? ` (locks: ${stats.lockedSkipped})` : '') +
          `\nEscenario: ${stats.stage ? 'sí' : 'no'}`,
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'No se pudo aplicar el import');
    }
  }

  function finishGaZone() {
    if (gaDraft.length < 3) return;
    const idx = map.sections.length;
    const id = `tmp-sec-${Date.now()}`;
    const sec: SeatMapSection = {
      id,
      name: `Zona GA ${idx + 1}`,
      slug: `ga-${idx}`,
      color: '#f59e0b',
      seats: [],
      shape: { points: gaDraft.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]) },
    };
    updateSections([...map.sections, sec]);
    setActiveSectionId(id);
    setGaDraft([]);
    setTool('select');
  }

  function cancelGaZone() {
    setGaDraft([]);
    setTool('select');
  }

  function addFurniture(type: SeatMapFurniture['type']) {
    if (cadLocks.furniture) {
      warnLocked('El mobiliario está bloqueado (CAD lock).');
      return;
    }
    const id = `furn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const n = furniture.length;
    const baseX = stage.x + stage.width / 2;
    const baseY = stage.y - 18;
    const offset = n % 2 === 0 ? -1 : 1;
    const item: SeatMapFurniture = {
      id,
      type,
      x: Math.round(baseX + offset * (40 + n * 6)),
      y: Math.round(baseY),
      rotation: 0,
      ...(levelFilter !== 'ALL' ? { levelId: levelFilter } : {}),
    };
    updateVenueMeta({ furniture: [...furniture, item] });
    setSelectedFurnitureId(id);
  }

  function patchFurniture(id: string, patch: Partial<SeatMapFurniture>) {
    if (cadLocks.furniture) return;
    updateVenueMeta({
      furniture: furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function removeFurniture(id: string) {
    if (cadLocks.furniture) {
      warnLocked('El mobiliario está bloqueado (CAD lock).');
      return;
    }
    updateVenueMeta({ furniture: furniture.filter((f) => f.id !== id) });
    setSelectedFurnitureId(null);
  }

  function deleteSelected() {
    if (!selected.size) return;
    updateSections(
      map.sections.map((s) => {
        if (s.locked) return s;
        return {
          ...s,
          seats: s.seats.filter((seat) => !selected.has(seat.id)),
        };
      }),
    );
    setSelected(EMPTY_SELECTION);
  }

  /**
   * Edición masiva de tarifa.
   *
   * Un solo recorrido sobre las secciones afectadas y un comando que guarda
   * únicamente la tarifa anterior de cada butaca: cambiar 45.000 butacas cuesta
   * unos milisegundos y ocupa una fracción de lo que ocupaba un clon completo.
   */
  function applyTier(tier: (typeof TIERS)[number]) {
    if (!selected.size) return;
    const { map: next, before } = applySeatProps(map, selected, { tier });
    if (!before.length) return;
    commit(next, {
      kind: 'seat-props',
      label: `Tarifa ${tier} en ${before.length} butaca(s)`,
      before,
      after: { tier },
    });
  }

  /** Selecciona de golpe todas las butacas de la zona activa. */
  function selectActiveSectionSeats() {
    if (!activeSection) return;
    const si = seatIndex.sections.findIndex((s) => s.id === activeSection.id);
    if (si < 0) return;
    const hits = seatsOfSection(seatIndex, si, []);
    setSelected(new Set(hits.map((i) => seatIndex.ids[i])));
  }

  /** Mueve la selección completa a otra zona (cambio masivo de precio/aforo). */
  function moveSelectionToSection(toSectionId: string) {
    if (!selected.size) return;
    const target = map.sections.find((s) => s.id === toSectionId);
    if (!target) return;
    const { map: next, before } = applySeatSection(map, selected, toSectionId);
    if (!before.length) return;
    commit(next, {
      kind: 'seat-section',
      label: `Mover ${before.length} butaca(s) a ${target.name}`,
      before,
      toSectionId,
    });
    setActiveSectionId(toSectionId);
  }

  /** Marca la selección como plaza accesible o acompañante. */
  function applyAccessibility(kind: 'wheelchair' | 'companion' | null) {
    if (!selected.size) return;
    const patch = kind
      ? { metadata: { accessible: true, accessibleKind: kind } }
      : { metadata: undefined };
    const { map: next, before } = applySeatProps(map, selected, patch as Partial<SeatMapSeat>);
    if (!before.length) return;
    commit(next, {
      kind: 'seat-props',
      label: kind
        ? `Marcar ${before.length} plaza(s) accesible(s)`
        : `Quitar accesibilidad de ${before.length} butaca(s)`,
      before,
      after: patch as Partial<SeatMapSeat>,
    });
  }

  /**
   * Crea las plazas de silla de ruedas que exige el aforo en la zona activa.
   *
   * Reutiliza butacas ya generadas en vez de inventar geometría: así el aforo
   * declarado no se mueve y no aparecen solapamientos nuevos.
   */
  function generateAccessibleForActiveSection() {
    if (!activeSection) return;
    const missing = Math.max(
      0,
      accessibility.requiredWheelchairSpaces - accessibility.wheelchairSpaces,
    );
    const count = missing || requiredWheelchairSpaces(activeSection.seats.length);
    if (!count) return;
    const { section: nextSection, created } = generateAccessibleSpaces(activeSection, { count });
    if (!created.wheelchair.length) return;
    const next: SeatMapData = {
      ...map,
      sections: map.sections.map((s) => (s.id === activeSection.id ? nextSection : s)),
    };
    pushHistory(
      next,
      `Generar ${created.wheelchair.length} plaza(s) accesible(s) en ${activeSection.name}`,
    );
    setSelected(new Set([...created.wheelchair, ...created.companions]));
  }

  function rotateSelected(delta = 15) {
    if (!selected.size) return;
    updateSections(
      map.sections.map((s) => {
        if (s.locked) return s;
        return {
          ...s,
          seats: s.seats.map((seat) =>
            selected.has(seat.id)
              ? { ...seat, rotation: ((seat.rotation ?? 0) + delta) % 360 }
              : seat,
          ),
        };
      }),
    );
  }

  function setSectionColor(color: string) {
    if (!activeSection) return;
    updateSections(
      map.sections.map((s) => (s.id === activeSection.id ? { ...s, color } : s)),
    );
  }

  async function handleSave() {
    // El análisis diferido puede ir por detrás del mapa: antes de guardar se
    // fuerza un pase completo sobre el estado actual, no sobre el diferido.
    const freshValidation = validateGeometry(resolveGeometry(map));
    if (!freshValidation.ok) {
      const errs = freshValidation.issues.filter((i) => i.severity === 'error');
      // eslint-disable-next-line no-alert
      window.alert(
        `No se puede guardar:\n${errs
          .slice(0, 8)
          .map((i) => `• ${i.message}`)
          .join('\n')}${errs.length > 8 ? `\n…y ${errs.length - 8} más` : ''}`,
      );
      return;
    }

    /*
     * El API no admite parcheo parcial: `PUT /venues/:id/layout` reemplaza el
     * documento entero y borra por omisión lo que no venga. Con 45.000 butacas
     * eso son ~10 MB por guardado, así que se confirma explícitamente y se avisa
     * del tamaño en lugar de mandarlo sin más.
     */
    const bytes = estimateMapBytes(map);
    const HEAVY_SAVE_BYTES = 2 * 1024 * 1024;
    if (bytes > HEAVY_SAVE_BYTES) {
      const ok = window.confirm(
        `Vas a guardar el mapa completo: ${seatCount.toLocaleString('es-MX')} butacas, ` +
          `~${formatBytes(bytes)}.\n\n` +
          'El API reemplaza el documento entero (no hay guardado parcial), así que ' +
          'cualquier zona que falte se borra.\n\n¿Continuar?',
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const scene = resolveGeometry(map);
      const payload = {
        ...scene.map,
        version: 3 as const,
        venue: {
          ...(scene.map.venue ?? {}),
          stage: scene.stage,
          aisles: scene.aisles,
          obstacles: scene.obstacles,
          stairs: scene.stairs,
          furniture: scene.furniture,
          levels: scene.levels,
          units: scene.units,
          scale: scene.scale,
          cadLocks: scene.map.venue?.cadLocks,
          snapPitch: scene.map.venue?.snapPitch,
          focusPoints: scene.map.venue?.focusPoints,
        },
        // Agrupar una vez en lugar de filtrar por sección: el `filter` dentro
        // del `map` era O(secciones × butacas) — 1,3 millones de comparaciones
        // en un recinto de 45.000 butacas y 30 zonas.
        sections: (() => {
          const bySection = new Map<string, SeatMapSeat[]>();
          for (const s of scene.seats) {
            const { sectionId, sectionName: _b, sectionColor: _c, rowIndex: _d, ...seat } = s;
            const arr = bySection.get(sectionId);
            if (arr) arr.push(seat);
            else bySection.set(sectionId, [seat]);
          }
          return scene.map.sections.map((sec) => ({
            ...sec,
            seats: bySection.get(sec.id) ?? [],
          }));
        })(),
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  }

  async function handleTemplate(id: (typeof TEMPLATES)[number]['id']) {
    if (!onApplyTemplate) return;
    const next = await onApplyTemplate(id);
    pushHistory(cloneMap(next));
    setActiveSectionId(next.sections[0]?.id ?? null);
    setSelected(EMPTY_SELECTION);
  }

  async function handleAi() {
    if (!onAiSuggest) return;
    const result = await onAiSuggest(aiPrompt);
    if (Array.isArray(result)) {
      const next = { ...map, sections: result };
      pushHistory(next);
    } else {
      pushHistory(cloneMap(result));
      setActiveSectionId(result.sections[0]?.id ?? null);
    }
  }

  function clientToWorld(clientX: number, clientY: number): Point {
    const raw = clientToWorldRaw(clientX, clientY);
    return snapEnabled ? snapPoint(raw, snapPitch) : raw;
  }

  /**
   * Posición sin ajustar a la rejilla.
   *
   * Para dibujar y colocar sí interesa el ajuste, pero para señalar una butaca
   * o arrastrar un rectángulo de selección no: cuantizar el puntero al paso de
   * rejilla desplaza el impacto y hace que la selección por área no coincida
   * con lo que el operador ve.
   */
  function clientToWorldRaw(clientX: number, clientY: number): Point {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    };
  }

  function handleSectionBackdropPointerDown(e: React.PointerEvent, sectionId: string) {
    if (tool !== 'move-section') return;
    if (sectionLocked(sectionId)) {
      warnLocked('La sección está bloqueada.');
      return;
    }
    e.stopPropagation();
    const sec = map.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const world = clientToWorld(e.clientX, e.clientY);
    const origSeats: Record<string, Point> = {};
    for (const s of sec.seats) origSeats[s.id] = { x: s.x, y: s.y };
    const origBlocks: Record<string, Point> = {};
    for (const b of sec.blocks ?? []) origBlocks[b.id] = { x: b.origin.x, y: b.origin.y };
    dragRef.current = {
      mode: 'section',
      sectionId,
      startX: world.x,
      startY: world.y,
      origSeats,
      origShape: sec.shape?.points,
      origBlocks,
    };
    setActiveSectionId(sectionId);
    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
  }

  function handleStagePointerDown(e: React.PointerEvent) {
    if (tool !== 'select') return;
    if (cadLocks.stage) {
      warnLocked('El escenario está bloqueado.');
      return;
    }
    e.stopPropagation();
    const world = clientToWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'stage',
      startX: world.x,
      startY: world.y,
      orig: { x: stage.x, y: stage.y, width: stage.width },
    };
    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
  }

  function handleStageResizePointerDown(e: React.PointerEvent, side: 'left' | 'right') {
    if (tool !== 'select') return;
    if (cadLocks.stage) {
      warnLocked('El escenario está bloqueado.');
      return;
    }
    e.stopPropagation();
    const world = clientToWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'stage-resize',
      side,
      startX: world.x,
      startY: world.y,
      orig: { x: stage.x, width: stage.width },
    };
    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
  }

  function handleFurniturePointerDown(e: React.PointerEvent, item: SeatMapFurniture) {
    if (tool !== 'select') return;
    if (cadLocks.furniture) {
      warnLocked('El mobiliario está bloqueado.');
      return;
    }
    e.stopPropagation();
    setSelectedFurnitureId(item.id);
    setSelected(EMPTY_SELECTION);
    const world = clientToWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'furniture',
      id: item.id,
      startX: world.x,
      startY: world.y,
      orig: { x: item.x, y: item.y },
    };
    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Antes solo se excluía INPUT: un Ctrl+Z dentro del textarea del asistente
      // de IA deshacía el mapa en vez del texto que se estaba escribiendo.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (e.key === 'Escape') {
        if (tool === 'ga') cancelGaZone();
        if (tool === 'aisle' || tool === 'obstacle' || tool === 'stairs') cancelPolyTool();
        if (tool === 'focus' || tool === 'exit') setTool('select');
        return;
      }
      if (e.key === 'Enter' && (tool === 'aisle' || tool === 'obstacle' || tool === 'stairs')) {
        finishPolyTool();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedFurnitureId) {
          removeFurniture(selectedFurnitureId);
          return;
        }
        deleteSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      // Ctrl+Y es el rehacer que espera quien viene de AutoCAD o de Windows.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(seatIndex.ids));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={styles.designer}>
      <aside className={styles.sidebar}>
        <h3>Secciones</h3>
        <ul className={styles.secList}>
          {map.sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === activeSection?.id ? styles.secActive : styles.secItem}
                onClick={() => {
                  setActiveSectionId(s.id);
                  setSelected(EMPTY_SELECTION);
                }}
              >
                <i style={{ background: s.color }} />
                <input
                  value={s.name}
                  onChange={(e) => renameSection(s.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <em>{s.seats.length || (s.shape ? 'GA' : 0)}</em>
              </button>
              <button type="button" className={styles.iconBtn} onClick={() => deleteSection(s.id)} title="Borrar sección">
                ×
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={addSection}>
          + Sección
        </button>
        {activeSection && (
          <>
            <label className={styles.colorPick}>
              Color zona
              <input
                type="color"
                value={activeSection.color || '#e11d48'}
                onChange={(e) => setSectionColor(e.target.value)}
              />
            </label>
            <label className={styles.paramField}>
              <span>
                <input
                  type="checkbox"
                  checked={Boolean(activeSection.locked)}
                  onChange={(e) =>
                    updateSections(
                      map.sections.map((s) =>
                        s.id === activeSection.id ? { ...s, locked: e.target.checked || undefined } : s,
                      ),
                    )
                  }
                />{' '}
                Bloquear sección activa
              </span>
            </label>
          </>
        )}

        <h3>CAD / constraints</h3>
        <div className={styles.stageTools}>
          {(
            [
              ['aisles', 'Pasillos'],
              ['obstacles', 'Obstáculos'],
              ['stairs', 'Escaleras'],
              ['exits', 'Salidas'],
              ['stage', 'Escenario'],
              ['furniture', 'Mobiliario'],
              ['focusPoints', 'Focos'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={styles.paramField}>
              <span>
                <input
                  type="checkbox"
                  checked={Boolean(cadLocks[key])}
                  onChange={(e) => patchCadLocks({ [key]: e.target.checked || undefined })}
                />{' '}
                Lock {label}
              </span>
            </label>
          ))}
          <label className={styles.paramField}>
            <span>
              <input
                type="checkbox"
                checked={Boolean(cadLocks.strictOverlaps)}
                onChange={(e) => patchCadLocks({ strictOverlaps: e.target.checked || undefined })}
              />{' '}
              Solapes = error (bloquea guardar)
            </span>
          </label>
        </div>

        <h3>Niveles</h3>
        <div className={styles.stageTools}>
          <button type="button" onClick={addLevel}>
            + Nivel
          </button>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as string | 'ALL')}
            aria-label="Filtrar nivel"
          >
            <option value="ALL">Todos</option>
            {(map.venue?.levels ?? []).map((lv) => (
              <option key={lv.id} value={lv.id}>
                {lv.name} (Z {lv.elevation})
              </option>
            ))}
          </select>
        </div>
        {(map.venue?.levels ?? []).map((lv) => (
          <div
            key={lv.id}
            style={{
              display: 'flex',
              gap: '0.35rem',
              alignItems: 'center',
              marginBottom: 6,
              flexWrap: 'wrap',
            }}
          >
            <input
              value={lv.name}
              aria-label={`Nombre nivel ${lv.id}`}
              onChange={(e) => updateLevel(lv.id, { name: e.target.value })}
              style={{ flex: '1 1 100px', minWidth: 0 }}
            />
            <label className={styles.paramField} style={{ margin: 0, flex: '0 0 auto' }}>
              Z
              <input
                type="number"
                value={lv.elevation}
                aria-label={`Elevación ${lv.name}`}
                onChange={(e) =>
                  updateLevel(lv.id, { elevation: Number(e.target.value) || 0 })
                }
                style={{ width: 72 }}
              />
            </label>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => deleteLevel(lv.id)}
              title="Eliminar nivel"
            >
              ×
            </button>
          </div>
        ))}
        {activeSection && (
          <label className={styles.paramField}>
            Nivel de sección activa
            <select
              value={activeSection.levelId ?? ''}
              onChange={(e) => assignSectionLevel(e.target.value || undefined)}
            >
              <option value="">— sin nivel —</option>
              {(map.venue?.levels ?? []).map((lv) => (
                <option key={lv.id} value={lv.id}>
                  {lv.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className={styles.sideHint}>
          Con filtro de nivel activo, pasillos/escaleras/salidas nuevas heredan ese nivel.
          Escaleras: desde = filtro, hacia = siguiente nivel.
        </p>

        <h3>Importar plano</h3>
        <label className={styles.paramField}>
          SVG (secciones / pasillos / obstáculos)
          <input
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importSvgFile(file);
              e.target.value = '';
            }}
          />
        </label>
        <label className={styles.paramField}>
          DXF ASCII (capas: aisle / obstacle / stage / stairs)
          <input
            type="file"
            accept=".dxf,application/dxf,image/vnd.dxf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importDxfFile(file);
              e.target.value = '';
            }}
          />
        </label>
        <p className={styles.sideHint}>
          SVG/DXF abren un panel de revisión: reclasifica o omite entidades antes de aplicar.
          Capas: aisle / obstacle / stage / stairs / exit|salida.
        </p>
        <div className={styles.stageTools}>
          <button type="button" onClick={exportDxf}>
            Exportar DXF
          </button>
          <button type="button" onClick={exportSvg}>
            Exportar SVG
          </button>
          <button
            type="button"
            onClick={exportEgressCsv}
            title="Exporta resumen, secciones y cuellos de botella de egress"
          >
            Exportar egress CSV
          </button>
        </div>

        <h3>Plantillas</h3>
        <div className={styles.templateGrid}>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!onApplyTemplate}
              onClick={() => void handleTemplate(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <h3>Escenario y mobiliario</h3>
        <div className={styles.stageTools}>
          <button type="button" onClick={() => addFurniture('led')}>
            + LED wall
          </button>
          <button type="button" onClick={() => addFurniture('speaker')}>
            + Speaker
          </button>
          {selectedFurnitureId && (
            <button type="button" className={styles.dangerBtn} onClick={() => removeFurniture(selectedFurnitureId)}>
              Quitar seleccionado
            </button>
          )}
        </div>
        {selectedFurnitureId && (map.venue?.levels?.length ?? 0) > 0 && (
          <label className={styles.paramField}>
            Nivel del mobiliario
            <select
              value={furniture.find((f) => f.id === selectedFurnitureId)?.levelId ?? ''}
              disabled={Boolean(cadLocks.furniture)}
              onChange={(e) =>
                patchFurniture(selectedFurnitureId, {
                  levelId: e.target.value || undefined,
                })
              }
            >
              <option value="">— todos / sin nivel —</option>
              {(map.venue?.levels ?? []).map((lv) => (
                <option key={lv.id} value={lv.id}>
                  {lv.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className={styles.sideHint}>Arrastra el escenario o el mobiliario directamente en el lienzo.</p>

        <h3>Bloque paramétrico</h3>
        <div className={styles.paramGrid}>
          {(
            [
              ['rows', 'Filas'],
              ['cols', 'Cols'],
              ['seatPitch', 'Seat pitch'],
              ['rowPitch', 'Row pitch'],
              ['rake', 'Rake (Z)'],
              ['curvature', 'Curvatura'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={styles.paramField}>
              {label}
              <input
                type="number"
                value={blockParams[key]}
                min={key === 'curvature' ? 0 : 1}
                step={key === 'curvature' || key === 'rake' ? 1 : 1}
                onChange={(e) =>
                  setBlockParams((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))
                }
              />
            </label>
          ))}
          <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
            Pasillo (cols vacías)
            <input
              type="text"
              value={blockParams.skipColumns}
              placeholder="6,7 o every:8"
              onChange={(e) => setBlockParams((p) => ({ ...p, skipColumns: e.target.value }))}
              title="Índices de columna a omitir (0-based), o every:N"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => addGrid(blockParams.rows, blockParams.cols)}
          disabled={!activeSection}
        >
          Insertar bloque
        </button>
        <button
          type="button"
          onClick={applyParamsToActiveBlocks}
          disabled={!activeSection?.blocks?.length || activeSection?.locked}
          title="Actualiza los bloques de la sección con estos parámetros y regenera asientos"
        >
          Aplicar a bloques
        </button>
        <div className={styles.stageTools}>
          <button
            type="button"
            onClick={() => rotateActiveBlocks(-15)}
            disabled={!activeSection?.blocks?.length || activeSection?.locked}
            title="Rotar bloques −15° y regenerar"
          >
            Rotar −15°
          </button>
          <button
            type="button"
            onClick={() => rotateActiveBlocks(15)}
            disabled={!activeSection?.blocks?.length || activeSection?.locked}
            title="Rotar bloques +15° y regenerar"
          >
            Rotar +15°
          </button>
        </div>
        <button
          type="button"
          onClick={fillActiveShape}
          disabled={!activeSection?.shape?.points?.length}
          title="Rellena el contorno de la sección activa con asientos"
        >
          Rellenar zona
        </button>
        <button
          type="button"
          onClick={regenerateActiveFromBlocks}
          disabled={!activeSection?.blocks?.length || activeSection?.locked}
          title="Regenera asientos de la sección activa desde sus bloques paramétricos"
        >
          Regen. sección
        </button>
        <button
          type="button"
          onClick={regenerateAllFromBlocks}
          title="Regenera asientos de todas las secciones con bloques (respeta bloqueos)"
        >
          Regen. bloques
        </button>
        <button type="button" onClick={applyMetricDefaults} title="Pitch ~0.52m / fila ~0.9m">
          Pitches métricos
        </button>
        <label className={styles.paramField} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          Snap ({snapPitch}u ≈ {(snapPitch / mapScale).toFixed(2)}m)
        </label>
        <button
          type="button"
          onClick={() => {
            const result = applySightlines();
            const rowBlocked = result.scores.filter((s) => s.rowBlocked).length;
            const occluded = result.scores.filter((s) => s.occluded).length;
            const levelLabel =
              levelFilter === 'ALL'
                ? 'todos los niveles'
                : (map.venue?.levels?.find((l) => l.id === levelFilter)?.name ?? levelFilter);
            setViewHeat(true);
            // eslint-disable-next-line no-alert
            window.alert(
              `Vistas calculadas (${levelLabel})\nAsientos: ${result.scores.length}\nFocos: ${result.focuses.length}\nPremium: ${result.summary.premium}\nGood: ${result.summary.good}\nFair: ${result.summary.fair}\nRestricted: ${result.summary.restricted}\nBlocked: ${result.summary.blocked}\nFila delante: ${rowBlocked}\nObstáculo: ${occluded}`,
            );
          }}
          disabled={!allSeats.length}
          title={
            levelFilter === 'ALL'
              ? 'Calcula calidad de vista en todo el venue'
              : 'Calcula calidad de vista solo en el nivel filtrado (otros niveles no se tocan)'
          }
        >
          Calcular vistas
        </button>
        <label className={styles.paramField} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={viewHeat}
            onChange={(e) => setViewHeat(e.target.checked)}
            disabled={!allSeats.length}
          />
          Heat de vista
        </label>
        <label className={styles.paramField} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={showCirculation}
            onChange={(e) => setShowCirculation(e.target.checked)}
            aria-controls="egress-legend egress-status"
          />
          Grafo circulación / salidas
        </label>
        {showCirculation && (
          <ul id="egress-legend" className={styles.egressLegend} aria-label="Leyenda de salidas">
            <li>
              <span className={`${styles.swatch} ${styles.swatchExit}`} aria-hidden />
              Salida
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchAisle}`} aria-hidden />
              Pasillo
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchStair}`} aria-hidden />
              Escalera
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchRoute}`} aria-hidden />
              Ruta
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchRouteActive}`} aria-hidden />
              Ruta activa
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchBottleneck}`} aria-hidden />
              Cuello de botella
            </li>
          </ul>
        )}
        {showCirculation && egressOverlay && (
          <p id="egress-status" className={styles.egressHint} role="status" aria-live="polite">
            {egressOverlay.hasNetwork
              ? `Rutas de salida · ${egressOverlay.paths.length} sección(es)${
                  egressOverlay.clearanceMinutes != null
                    ? ` · vaciado ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                    : ''
                }`
              : 'Sin red de pasillos/salidas para calcular rutas'}
          </p>
        )}
        {unreachableOnLevelCount > 0 && (
          <p className={styles.sideHint}>
            {unreachableOnLevelCount} sección(es) sin ruta a salida
            {levelFilter !== 'ALL' ? ' (nivel actual)' : ''}
          </p>
        )}
        {showCirculation && circulation?.egress && circulation.hasNetwork && (
          <div className={styles.sideHint} style={{ marginTop: '0.35rem' }}>
            <strong>Egress</strong>
            <div>
              semillas:{' '}
              {circulation.seedMode === 'exits'
                ? `${circulation.exitCount} salida(s)`
                : circulation.seedMode === 'stage'
                  ? 'escenario (sin salidas)'
                  : 'red pasillos'}
            </div>
            <div>
              max ruta:{' '}
              {circulation.egress.maxPathLength != null
                ? `${Math.round(circulation.egress.maxPathLength)}u`
                : '—'}
              {' · '}
              avg:{' '}
              {circulation.egress.avgPathLength != null
                ? `${Math.round(circulation.egress.avgPathLength)}u`
                : '—'}
            </div>
            <div>
              con salida: {circulation.egress.totalSeatsWithPath} · sin:{' '}
              {circulation.egress.totalSeatsWithoutPath}
            </div>
            {bottlenecksView[0] && (
              <div>
                bottleneck: {bottlenecksView[0].kind}{' '}
                {Math.round(bottlenecksView[0].utilization * 100)}% (
                {bottlenecksView[0].seatLoad}/
                {bottlenecksView[0].capacity}, ancho{' '}
                {bottlenecksView[0].width}u)
              </div>
            )}
            {circulation.egress.clearanceMinutes != null && (
              <div>
                vaciado estimado: {circulation.egress.clearanceMinutes.toFixed(1)} min
                {circulation.egress.maxWalkMinutes != null
                  ? ` · caminata max ${circulation.egress.maxWalkMinutes.toFixed(1)} min`
                  : ''}
              </div>
            )}
            {activeEgressPath && (
              <div>
                ruta sección activa:{' '}
                {activeEgressPath.length != null ? `${Math.round(activeEgressPath.length)}u` : '—'}
                {(() => {
                  const secEg = circulation.egress.sections.find(
                    (s) => s.sectionId === activeSection?.id,
                  );
                  return secEg?.clearanceMinutes != null
                    ? ` · ~${secEg.clearanceMinutes.toFixed(1)} min`
                    : '';
                })()}
              </div>
            )}

            <div style={{ marginTop: '0.55rem', maxHeight: 160, overflow: 'auto' }}>
              <strong>Secciones</strong>
              <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse', marginTop: 4 }}>
                <thead>
                  <tr style={{ textAlign: 'left', opacity: 0.75 }}>
                    <th>Zona</th>
                    <th>N</th>
                    <th>Ruta</th>
                    <th>min</th>
                  </tr>
                </thead>
                <tbody>
                  {egressSectionsView.slice(0, 12).map((s) => (
                    <tr
                      key={s.sectionId}
                      style={{
                        background:
                          s.sectionId === activeSection?.id ? 'rgba(251,191,36,0.12)' : undefined,
                      }}
                    >
                      <td style={{ padding: '1px 2px' }}>{(s.sectionName ?? s.sectionId).slice(0, 14)}</td>
                      <td style={{ padding: '1px 2px' }}>{s.seatCount}</td>
                      <td style={{ padding: '1px 2px' }}>
                        {s.pathLength != null ? Math.round(s.pathLength) : '—'}
                      </td>
                      <td style={{ padding: '1px 2px' }}>
                        {s.clearanceMinutes != null ? s.clearanceMinutes.toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bottlenecksView.length > 0 && (
              <div style={{ marginTop: '0.45rem', maxHeight: 110, overflow: 'auto' }}>
                <strong>Bottlenecks</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                  {bottlenecksView.slice(0, 5).map((b) => (
                    <li key={b.edgeId}>
                      {b.kind} · {Math.round(b.utilization * 100)}% · {b.seatLoad}/{b.capacity} · ~
                      {b.clearanceMinutes.toFixed(1)} min
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.paramGrid} style={{ marginTop: '0.5rem' }}>
              <label className={styles.paramField}>
                Vaciado max (min)
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  value={resolveEgressPolicy(map.venue?.egressPolicy).slowClearanceMinutes}
                  onChange={(e) =>
                    patchEgressPolicy({
                      slowClearanceMinutes: Math.max(1, Number(e.target.value) || 8),
                    })
                  }
                />
              </label>
              <label className={styles.paramField}>
                Ruta larga (u)
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={50}
                  value={resolveEgressPolicy(map.venue?.egressPolicy).longPathUnits}
                  onChange={(e) =>
                    patchEgressPolicy({
                      longPathUnits: Math.max(100, Number(e.target.value) || 900),
                    })
                  }
                />
              </label>
              <label className={styles.paramField}>
                Util. bottleneck
                <input
                  type="number"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={resolveEgressPolicy(map.venue?.egressPolicy).bottleneckUtilization}
                  onChange={(e) =>
                    patchEgressPolicy({
                      bottleneckUtilization: Math.min(
                        1,
                        Math.max(0.5, Number(e.target.value) || 0.85),
                      ),
                    })
                  }
                />
              </label>
              <label className={styles.paramField}>
                Carga bottleneck
                <input
                  type="number"
                  min={20}
                  max={2000}
                  step={10}
                  value={resolveEgressPolicy(map.venue?.egressPolicy).bottleneckSeatLoad}
                  onChange={(e) =>
                    patchEgressPolicy({
                      bottleneckSeatLoad: Math.max(20, Number(e.target.value) || 120),
                    })
                  }
                />
              </label>
            </div>
            <button type="button" onClick={exportEgressCsv} style={{ marginTop: '0.35rem' }}>
              Descargar CSV (local)
            </button>
            {venueId && (
              <div className={styles.stageTools} style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => void exportEgressCsvFromServer('draft')}
                  title="Analiza el mapa actual (aunque no esté guardado) vía API"
                >
                  CSV API (borrador)
                </button>
                <button
                  type="button"
                  onClick={() => void exportEgressCsvFromServer('saved')}
                  title="Descarga el reporte del layout guardado en servidor"
                >
                  CSV API (guardado)
                </button>
                <button
                  type="button"
                  onClick={() => void exportEgressPdfFromServer('draft')}
                  title="PDF del mapa actual vía API"
                >
                  PDF (borrador)
                </button>
                <button
                  type="button"
                  onClick={() => void exportEgressPdfFromServer('saved')}
                  title="PDF del layout guardado"
                >
                  PDF (guardado)
                </button>
              </div>
            )}
          </div>
        )}
        {aisles.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <strong className={styles.sideHint}>Pasillos</strong>
            {aisles.map((a) => (
              <div key={a.id} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <label className={styles.paramField} style={{ flex: 1, margin: 0 }}>
                    {a.id.replace(/^tmp-poly-/, 'pasillo-').slice(0, 18)} · ancho
                    <input
                      type="number"
                      min={8}
                      max={120}
                      value={a.width ?? 24}
                      disabled={Boolean(cadLocks.aisles)}
                      onChange={(e) =>
                        patchAisle(a.id, { width: Math.max(8, Number(e.target.value) || 24) })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={Boolean(cadLocks.aisles)}
                    onClick={() => removeAisle(a.id)}
                    title="Eliminar pasillo"
                  >
                    ×
                  </button>
                </div>
                {(map.venue?.levels?.length ?? 0) > 0 && (
                  <label className={styles.paramField}>
                    Nivel
                    <select
                      value={a.levelId ?? ''}
                      disabled={Boolean(cadLocks.aisles)}
                      onChange={(e) =>
                        patchAisle(a.id, { levelId: e.target.value || undefined })
                      }
                    >
                      <option value="">— auto / todos —</option>
                      {(map.venue?.levels ?? []).map((lv) => (
                        <option key={lv.id} value={lv.id}>
                          {lv.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
        )}
        {stairs.length > 0 && (
          <div style={{ marginTop: '0.35rem' }}>
            <strong className={styles.sideHint}>Escaleras / vomitorios</strong>
            {stairs.map((s) => (
              <div key={s.id} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #e5e5e5' }}>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <label className={styles.paramField} style={{ flex: 1, margin: 0 }}>
                    {s.id.replace(/^tmp-poly-/, '').slice(0, 14)} · ancho
                    <input
                      type="number"
                      min={8}
                      max={120}
                      value={s.width ?? 28}
                      disabled={Boolean(cadLocks.stairs)}
                      onChange={(e) =>
                        patchStair(s.id, { width: Math.max(8, Number(e.target.value) || 28) })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={Boolean(cadLocks.stairs)}
                    onClick={() => removeStair(s.id)}
                    title="Eliminar escalera"
                  >
                    ×
                  </button>
                </div>
                <label className={styles.paramField}>
                  Tipo
                  <select
                    value={s.kind ?? 'stairs'}
                    disabled={Boolean(cadLocks.stairs)}
                    onChange={(e) =>
                      patchStair(s.id, {
                        kind: e.target.value as 'stairs' | 'vomitoria' | 'ramp',
                      })
                    }
                  >
                    <option value="stairs">Escalera</option>
                    <option value="vomitoria">Vomitorio</option>
                    <option value="ramp">Rampa</option>
                  </select>
                </label>
                <label className={styles.paramField}>
                  Desde nivel
                  <select
                    value={s.fromLevelId ?? ''}
                    disabled={Boolean(cadLocks.stairs)}
                    onChange={(e) =>
                      patchStair(s.id, { fromLevelId: e.target.value || undefined })
                    }
                  >
                    <option value="">— auto —</option>
                    {(map.venue?.levels ?? []).map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {lv.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.paramField}>
                  Hacia nivel
                  <select
                    value={s.toLevelId ?? ''}
                    disabled={Boolean(cadLocks.stairs)}
                    onChange={(e) =>
                      patchStair(s.id, { toLevelId: e.target.value || undefined })
                    }
                  >
                    <option value="">— auto —</option>
                    {(map.venue?.levels ?? []).map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {lv.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
        )}
        {obstacles.length > 0 && (
          <div style={{ marginTop: '0.35rem' }}>
            <strong className={styles.sideHint}>Obstáculos</strong>
            {obstacles.map((o) => (
              <div key={o.id} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <label className={styles.paramField} style={{ flex: 1, margin: 0 }}>
                    {o.id.replace(/^tmp-poly-/, 'obs-').slice(0, 16)} · alto
                    <input
                      type="number"
                      min={20}
                      max={400}
                      value={o.height ?? 120}
                      disabled={Boolean(cadLocks.obstacles)}
                      onChange={(e) =>
                        patchObstacle(o.id, {
                          height: Math.max(20, Number(e.target.value) || 120),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={Boolean(cadLocks.obstacles)}
                    onClick={() => removeObstacle(o.id)}
                    title="Eliminar obstáculo"
                  >
                    ×
                  </button>
                </div>
                {(map.venue?.levels?.length ?? 0) > 0 && (
                  <label className={styles.paramField}>
                    Nivel
                    <select
                      value={o.levelId ?? ''}
                      disabled={Boolean(cadLocks.obstacles)}
                      onChange={(e) =>
                        patchObstacle(o.id, { levelId: e.target.value || undefined })
                      }
                    >
                      <option value="">— auto / todos —</option>
                      {(map.venue?.levels ?? []).map((lv) => (
                        <option key={lv.id} value={lv.id}>
                          {lv.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: '0.5rem' }}>
          <strong className={styles.sideHint}>Salidas (egress)</strong>
          <p className={styles.sideHint}>
            Tool Salida + click en el mapa. Las rutas de vaciado van a estas puertas.
          </p>
          {exits.map((ex) => (
            <div key={ex.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginBottom: 4 }}>
                <input
                  value={ex.label ?? ''}
                  disabled={Boolean(cadLocks.exits)}
                  placeholder="Nombre"
                  onChange={(e) => patchExit(ex.id, { label: e.target.value || undefined })}
                  style={{ flex: 1, minWidth: 0 }}
                  aria-label={`Nombre salida ${ex.id}`}
                />
                <input
                  type="number"
                  min={8}
                  max={120}
                  title="Ancho"
                  value={ex.width ?? 32}
                  disabled={Boolean(cadLocks.exits)}
                  onChange={(e) =>
                    patchExit(ex.id, { width: Math.max(8, Number(e.target.value) || 32) })
                  }
                  style={{ width: 64 }}
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={Boolean(cadLocks.exits)}
                  onClick={() => removeExit(ex.id)}
                  title="Eliminar salida"
                >
                  ×
                </button>
              </div>
              {(map.venue?.levels?.length ?? 0) > 0 && (
                <label className={styles.paramField}>
                  Nivel
                  <select
                    value={ex.levelId ?? ''}
                    disabled={Boolean(cadLocks.exits)}
                    onChange={(e) =>
                      patchExit(ex.id, { levelId: e.target.value || undefined })
                    }
                  >
                    <option value="">— auto / todos —</option>
                    {(map.venue?.levels ?? []).map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {lv.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ))}
        </div>
        <div className={styles.stageTools}>
          <button
            type="button"
            onClick={seedStageFocuses}
            disabled={Boolean(cadLocks.focusPoints)}
            title="3 focos L/C/R sobre el escenario"
          >
            Focos L/C/R
          </button>
          <button
            type="button"
            onClick={clearFocuses}
            disabled={Boolean(cadLocks.focusPoints) || !(map.venue?.focusPoints?.length)}
          >
            Quitar focos
          </button>
        </div>
        {(map.venue?.focusPoints?.length ?? 0) > 0 && (
          <ul className={styles.sideHint} style={{ listStyle: 'none', padding: 0, margin: '0.35rem 0' }}>
            {map.venue!.focusPoints!.map((f) => (
              <li key={f.id} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginBottom: 4 }}>
                  <input
                    value={f.label ?? ''}
                    onChange={(e) => renameFocus(f.id, e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                    disabled={Boolean(cadLocks.focusPoints)}
                    aria-label={`Nombre foco ${f.id}`}
                  />
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => removeFocus(f.id)}
                    disabled={Boolean(cadLocks.focusPoints)}
                    title="Eliminar foco"
                  >
                    ×
                  </button>
                </div>
                {(map.venue?.levels?.length ?? 0) > 0 && (
                  <label className={styles.paramField}>
                    Nivel
                    <select
                      value={f.levelId ?? ''}
                      disabled={Boolean(cadLocks.focusPoints)}
                      onChange={(e) =>
                        patchFocus(f.id, { levelId: e.target.value || undefined })
                      }
                    >
                      <option value="">— auto / todos —</option>
                      {(map.venue?.levels ?? []).map((lv) => (
                        <option key={lv.id} value={lv.id}>
                          {lv.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
        {(map.venue?.focusPoints?.length ?? 0) > 0 && (
          <p className={styles.sideHint}>
            {map.venue!.focusPoints!.length} focos · sightlines toma el mejor por asiento
            {tool === 'focus' && !cadLocks.focusPoints ? ' · click mapa = nuevo, click foco = borrar' : ''}
            {cadLocks.focusPoints ? ' · bloqueados (CAD lock)' : ''}
          </p>
        )}

        {selected.size > 0 && (
          <>
            <h3>Selección ({selected.size.toLocaleString('es-MX')})</h3>
            {/*
              Accesibilidad: `Seat.accessible` existe en base de datos pero el
              documento de mapa no tiene campo propio, así que la marca viaja en
              `metadata` con las claves que lee el motor.
            */}
            <div className={styles.stageTools}>
              <button
                type="button"
                onClick={() => applyAccessibility('wheelchair')}
                title="Marcar como espacio para silla de ruedas"
              >
                ♿ Silla
              </button>
              <button
                type="button"
                onClick={() => applyAccessibility('companion')}
                title="Marcar como butaca de acompañante"
              >
                Acompañante
              </button>
              <button type="button" onClick={() => applyAccessibility(null)} title="Quitar marca">
                Quitar acc.
              </button>
            </div>
            <label className={styles.paramField}>
              Elevación Z
              <input
                type="number"
                defaultValue={firstSelectedSeat?.elevation ?? 0}
                onBlur={(e) => applyElevationToSelected(Number(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyElevationToSelected(Number((e.target as HTMLInputElement).value) || 0);
                  }
                }}
              />
            </label>
            <div className={styles.stageTools}>
              <button type="button" onClick={() => applyVisibilityToSelected({ blocked: true })}>
                Blocked
              </button>
              <button
                type="button"
                onClick={() => applyVisibilityToSelected({ restrictedView: true })}
              >
                Restricted
              </button>
              <button
                type="button"
                onClick={() => applyVisibilityToSelected({ premiumView: true })}
              >
                Premium view
              </button>
              <button
                type="button"
                onClick={() =>
                  applyVisibilityToSelected({
                    blocked: false,
                    restrictedView: false,
                    premiumView: false,
                  })
                }
              >
                Limpiar flags
              </button>
            </div>
          </>
        )}

        {accessibility.capacity > 0 && (
          <div className={styles.accessBox}>
            <h3>Accesibilidad</h3>
            <p>
              <span className={styles.issueTag} data-ok={accessibility.compliant || undefined}>
                {accessibility.compliant ? 'OK' : 'FALTA'}
              </span>
              {accessibility.wheelchairSpaces} de {accessibility.requiredWheelchairSpaces} plazas de
              silla de ruedas · {accessibility.companionSeats} acompañantes
            </p>
            <div className={styles.stageTools}>
              <button
                type="button"
                onClick={generateAccessibleForActiveSection}
                disabled={!activeSection?.seats.length}
                title={
                  activeSection
                    ? `Convertir butacas del final de fila de ${activeSection.name} en plazas accesibles`
                    : 'Selecciona una zona primero'
                }
              >
                Generar plazas accesibles
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids: string[] = [];
                  for (let i = 0; i < seatIndex.count; i++) {
                    if (seatIndex.flags[i] & SEAT_FLAG.ACCESSIBLE) ids.push(seatIndex.ids[i]);
                  }
                  if (ids.length) focusOnEntities(ids, undefined);
                }}
                disabled={accessibility.wheelchairSpaces + accessibility.companionSeats === 0}
                title="Selecciona y encuadra todas las plazas accesibles del mapa"
              >
                Ver las existentes
              </button>
            </div>
          </div>
        )}

        {actionableIssues.length > 0 && (
          <div className={styles.validationBanner} role="status" aria-live="polite">
            <strong>
              {errorCount > 0
                ? `${errorCount} ${errorCount === 1 ? 'error impide' : 'errores impiden'} publicar`
                : `${actionableIssues.length} avisos`}
              {' · '}
              {actionableIssues.length} en total
              {levelFilter !== 'ALL' ? ' (nivel actual)' : ''}
            </strong>
            <ul className={styles.issueList}>
              {actionableIssues.slice(0, 12).map((issue, i) => {
                const targetable = Boolean(issue.seatIds?.length || issue.sectionIds?.length);
                return (
                  <li key={`${issue.message}-${i}`} data-severity={issue.severity}>
                    {/* La severidad se lee, no se adivina por el color del borde. */}
                    <span className={styles.issueTag}>
                      {issue.severity === 'error' ? 'ERROR' : 'AVISO'}
                    </span>
                    {targetable ? (
                      <button
                        type="button"
                        className={styles.issueLink}
                        onClick={() => focusOnEntities(issue.seatIds, issue.sectionIds)}
                        title="Llevar la vista a la zona o butaca del problema"
                      >
                        {issue.message}
                      </button>
                    ) : (
                      <span className={styles.issueText}>{issue.message}</span>
                    )}
                    {issue.hint && <p className={styles.issueHint}>{issue.hint}</p>}
                  </li>
                );
              })}
            </ul>
            {actionableIssues.length > 12 && (
              <p className={styles.issueHint}>
                …y {actionableIssues.length - 12} más. Resuelve los de arriba y la lista se recalcula.
              </p>
            )}
          </div>
        )}
      </aside>

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.toolGroup}>
            <button type="button" className={tool === 'select' ? styles.primary : ''} onClick={() => setTool('select')}>
              Seleccionar
            </button>
            <button type="button" className={tool === 'pan' ? styles.primary : ''} onClick={() => setTool('pan')}>
              Pan
            </button>
            <button
              type="button"
              className={tool === 'move-section' ? styles.primary : ''}
              onClick={() => setTool('move-section')}
              disabled={!map.sections.length}
              title="Arrastra una zona completa (asientos + forma)"
            >
              Mover sección
            </button>
            <button
              type="button"
              className={tool === 'ga' ? styles.primary : ''}
              onClick={() => setTool(tool === 'ga' ? 'select' : 'ga')}
              title="Dibuja una zona sin asientos (pista/festival)"
            >
              Zona GA
            </button>
            <button
              type="button"
              className={tool === 'aisle' ? styles.primary : ''}
              onClick={() => {
                setPolyDraft([]);
                setTool(tool === 'aisle' ? 'select' : 'aisle');
              }}
              disabled={Boolean(cadLocks.aisles)}
              title="Dibuja un pasillo (polilínea)"
            >
              Pasillo
            </button>
            <button
              type="button"
              className={tool === 'obstacle' ? styles.primary : ''}
              onClick={() => {
                setPolyDraft([]);
                setTool(tool === 'obstacle' ? 'select' : 'obstacle');
              }}
              disabled={Boolean(cadLocks.obstacles)}
              title="Dibuja un obstáculo (polígono)"
            >
              Obstáculo
            </button>
            <button
              type="button"
              className={tool === 'stairs' ? styles.primary : ''}
              onClick={() => {
                setPolyDraft([]);
                setTool(tool === 'stairs' ? 'select' : 'stairs');
              }}
              disabled={Boolean(cadLocks.stairs)}
              title="Dibuja escalera / vomitorio"
            >
              Escalera
            </button>
            <button
              type="button"
              className={tool === 'exit' ? styles.primary : ''}
              onClick={() => setTool(tool === 'exit' ? 'select' : 'exit')}
              disabled={Boolean(cadLocks.exits)}
              title="Click en el mapa para colocar una salida"
            >
              Salida
            </button>
            <button
              type="button"
              className={tool === 'focus' ? styles.primary : ''}
              onClick={() => setTool(tool === 'focus' ? 'select' : 'focus')}
              disabled={Boolean(cadLocks.focusPoints)}
              title="Click en el mapa para colocar un foco de vista"
            >
              Foco
            </button>
            {tool === 'ga' && (
              <>
                <button type="button" onClick={finishGaZone} disabled={gaDraft.length < 3}>
                  Cerrar zona ({gaDraft.length})
                </button>
                <button type="button" onClick={cancelGaZone}>
                  Cancelar
                </button>
              </>
            )}
            {(tool === 'aisle' || tool === 'obstacle' || tool === 'stairs') && (
              <>
                <button
                  type="button"
                  onClick={finishPolyTool}
                  disabled={polyDraft.length < (tool === 'aisle' || tool === 'stairs' ? 2 : 3)}
                >
                  Cerrar ({polyDraft.length})
                </button>
                <button type="button" onClick={cancelPolyTool}>
                  Cancelar
                </button>
              </>
            )}
          </div>

          <div className={styles.toolGroup}>
            <button type="button" onClick={() => addRow(12)} disabled={!activeSection}>
              + Fila
            </button>
            <button type="button" onClick={() => addGrid(5, 12)} disabled={!activeSection}>
              + Grid 5×12
            </button>
            <button type="button" onClick={() => addCurvedRow()} disabled={!activeSection} title="Fila en arco (teatro/arena)">
              Fila curva
            </button>
          </div>

          <div className={styles.toolGroup}>
            <button type="button" onClick={deleteSelected} disabled={!selected.size}>
              Eliminar ({selected.size})
            </button>
            {TIERS.map((t) => (
              <button key={t} type="button" onClick={() => applyTier(t)} disabled={!selected.size}>
                {t}
              </button>
            ))}
            {/*
              La selección por zona existía en el código pero no tenía botón:
              seleccionar 1.500 butacas a rectángulo es inviable, y el atajo por
              zona resuelve en 0,06 ms lo que el arrastre hace en varios pasos.
            */}
            <button
              type="button"
              onClick={selectActiveSectionSeats}
              disabled={!activeSection?.seats.length}
              title={
                activeSection
                  ? `Seleccionar las ${activeSection.seats.length.toLocaleString('es-MX')} butacas de ${activeSection.name}`
                  : 'No hay zona activa'
              }
            >
              Seleccionar zona
            </button>
            <button type="button" onClick={() => rotateSelected(15)} disabled={!selected.size}>
              Rotar +15°
            </button>
            {/*
              El atajo va en el propio botón, no solo en `title`: un tooltip no
              se ve con teclado ni con lector de pantalla, y deshacer es la
              función que más se busca cuando una edición masiva sale mal.
            */}
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo(history)}
              aria-keyshortcuts="Control+Z"
              title={undoLabel(history) ? `Deshacer: ${undoLabel(history)}` : 'Nada que deshacer'}
            >
              ↶ Deshacer <kbd className={styles.kbd}>Ctrl+Z</kbd>
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo(history)}
              aria-keyshortcuts="Control+Shift+Z Control+Y"
              title={redoLabel(history) ? `Rehacer: ${redoLabel(history)}` : 'Nada que rehacer'}
            >
              ↷ Rehacer <kbd className={styles.kbd}>Ctrl+Shift+Z</kbd>
            </button>
            {/* Qué se deshará exactamente, sin tener que pasar el ratón. */}
            {(undoLabel(history) || redoLabel(history)) && (
              <span className={styles.historyHint} aria-live="polite">
                {undoLabel(history) ? `Deshace: ${undoLabel(history)}` : 'Nada que deshacer'}
              </span>
            )}
          </div>

          <div className={styles.toolGroup}>
            <button
              type="button"
              onClick={selectActiveSectionSeats}
              disabled={!activeSection}
              title="Seleccionar todas las butacas de la zona activa"
            >
              Sel. zona
            </button>
            <button
              type="button"
              onClick={() => setSelected(EMPTY_SELECTION)}
              disabled={!selected.size}
            >
              Limpiar sel.
            </button>
            {map.sections.length > 1 && (
              <select
                value=""
                disabled={!selected.size}
                onChange={(e) => {
                  if (e.target.value) moveSelectionToSection(e.target.value);
                  e.currentTarget.value = '';
                }}
                title="Mover la selección a otra zona"
              >
                <option value="">Mover a zona…</option>
                {map.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.toolGroup}>
            <button type="button" onClick={() => setScale((s) => Math.min(3, s * 1.15))}>
              +
            </button>
            <button type="button" onClick={() => setScale((s) => Math.max(0.35, s / 1.15))}>
              −
            </button>
            <button
              type="button"
              onClick={() => {
                setScale(1);
                setTx(40);
                setTy(40);
              }}
            >
              Reset vista
            </button>
          </div>

          <button type="button" className={styles.primary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar mapa'}
          </button>
        </div>

        {onAiSuggest && (
          <div className={styles.ai}>
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe el venue…"
            />
            <button type="button" onClick={() => void handleAi()}>
              Generar con prompt
            </button>
          </div>
        )}

        <div
          ref={viewportRef}
          className={styles.viewport}
          role="img"
          aria-label={
            showCirculation ? 'Mapa del venue con rutas de salida' : 'Mapa del venue'
          }
          aria-describedby={showCirculation ? 'egress-legend egress-status' : undefined}
          onWheel={(e) => {
            e.preventDefault();
            setScale((s) => Math.min(3, Math.max(0.35, s * (e.deltaY > 0 ? 0.92 : 1.08))));
          }}
          onPointerDown={(e) => {
            if (tool === 'ga') {
              if (e.button !== 0) return;
              setGaDraft((prev) => [...prev, clientToWorld(e.clientX, e.clientY)]);
              return;
            }
            if (tool === 'focus') {
              if (e.button !== 0) return;
              addFocusAt(clientToWorld(e.clientX, e.clientY));
              return;
            }
            if (tool === 'exit') {
              if (e.button !== 0) return;
              addExitAt(clientToWorld(e.clientX, e.clientY));
              return;
            }
            if (tool === 'aisle' || tool === 'obstacle' || tool === 'stairs') {
              if (e.button !== 0) return;
              setPolyDraft((prev) => [...prev, clientToWorld(e.clientX, e.clientY)]);
              return;
            }
            if (tool === 'pan' || e.button === 1) {
              dragRef.current = {
                mode: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                panTx: tx,
                panTy: ty,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
            if (tool === 'select' && e.button === 0) {
              const world = clientToWorldRaw(e.clientX, e.clientY);

              // Impacto directo sobre una butaca: la rejilla resuelve en microsegundos.
              const hit = hitTestSeat(seatIndex, world.x, world.y, seatIndex.pitch * 0.6);
              if (hit >= 0) {
                const seatId = seatIndex.ids[hit];
                const sectionId = seatIndex.sections[seatIndex.sectionIdx[hit]]?.id;
                const next = e.shiftKey
                  ? new Set(selected).add(seatId)
                  : selected.has(seatId) && selected.size > 1
                    ? selected
                    : new Set([seatId]);
                setSelected(next);
                setSelectedFurnitureId(null);
                if (sectionId) setActiveSectionId(sectionId);

                if (sectionId && !sectionLocked(sectionId)) {
                  const orig: Record<string, Point> = {};
                  const movable: string[] = [];
                  for (const id of next) {
                    const i = seatIndex.idToIdx.get(id);
                    if (i === undefined) continue;
                    const secId = seatIndex.sections[seatIndex.sectionIdx[i]]?.id;
                    if (secId && sectionLocked(secId)) continue;
                    movable.push(id);
                    orig[id] = { x: seatIndex.x[i], y: seatIndex.y[i] };
                  }
                  if (movable.length) {
                    dragRef.current = {
                      mode: 'seat',
                      seatIds: movable,
                      startX: world.x,
                      startY: world.y,
                      orig,
                    };
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }
                }
                return;
              }

              // Clic en vacío: empieza selección por rectángulo.
              if (!e.shiftKey) setSelected(EMPTY_SELECTION);
              setSelectedFurnitureId(null);
              marqueeRef.current = { x0: world.x, y0: world.y, additive: e.shiftKey };
              setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }
          }}
          onDoubleClick={() => {
            if (tool === 'ga' && gaDraft.length >= 3) finishGaZone();
            if ((tool === 'aisle' || tool === 'obstacle' || tool === 'stairs') && polyDraft.length >= 2)
              finishPolyTool();
          }}
          onPointerMove={(e) => {
            // Selección por rectángulo en curso.
            const mq = marqueeRef.current;
            if (mq) {
              const world = clientToWorldRaw(e.clientX, e.clientY);
              setMarquee({ x0: mq.x0, y0: mq.y0, x1: world.x, y1: world.y });
              return;
            }
            const d = dragRef.current;
            if (!d) return;
            if (d.mode === 'pan') {
              setTx(d.panTx + (e.clientX - d.startX));
              setTy(d.panTy + (e.clientY - d.startY));
              return;
            }
            const world = clientToWorld(e.clientX, e.clientY);
            const dx = world.x - d.startX;
            const dy = world.y - d.startY;

            if (d.mode === 'seat') {
              setMap((prev) => ({
                ...prev,
                sections: prev.sections.map((sec) => {
                  if (sec.locked) return sec;
                  return {
                    ...sec,
                    seats: sec.seats.map((seat) => {
                      if (!d.seatIds.includes(seat.id)) return seat;
                      const o = d.orig[seat.id];
                      if (!o) return seat;
                      const x = Math.round(o.x + dx);
                      const y = Math.round(o.y + dy);
                      const elev = seat.elevation ?? seat.position?.y ?? 0;
                      return {
                        ...seat,
                        x,
                        y,
                        position: { x, y: elev, z: y },
                        coord3d: {
                          x,
                          y: elev,
                          z: y,
                          pitch: seat.rotation3d?.x ?? seat.coord3d?.pitch,
                          roll: seat.rotation3d?.z ?? seat.coord3d?.roll,
                        },
                      };
                    }),
                  };
                }),
              }));
              return;
            }

            if (d.mode === 'section') {
              setMap((prev) => ({
                ...prev,
                sections: prev.sections.map((sec) => {
                  if (sec.id !== d.sectionId) return sec;
                  return {
                    ...sec,
                    seats: sec.seats.map((seat) => {
                      const o = d.origSeats[seat.id];
                      return o ? { ...seat, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : seat;
                    }),
                    shape: d.origShape
                      ? {
                          points: d.origShape.map(
                            ([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as [number, number],
                          ),
                        }
                      : sec.shape,
                    blocks: sec.blocks?.map((b) => {
                      const o = d.origBlocks?.[b.id];
                      return o
                        ? { ...b, origin: { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } }
                        : b;
                    }),
                  };
                }),
              }));
              return;
            }

            if (d.mode === 'block') {
              setMap((prev) => ({
                ...prev,
                sections: prev.sections.map((sec) => {
                  if (sec.id !== d.sectionId) return sec;
                  return {
                    ...sec,
                    blocks: sec.blocks?.map((b) =>
                      b.id === d.blockId
                        ? {
                            ...b,
                            origin: {
                              x: Math.round(d.origOrigin.x + dx),
                              y: Math.round(d.origOrigin.y + dy),
                            },
                          }
                        : b,
                    ),
                  };
                }),
              }));
              return;
            }

            if (d.mode === 'stage') {
              setMap((prev) => ({
                ...prev,
                venue: {
                  ...prev.venue,
                  stage: { ...prev.venue?.stage, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy), width: d.orig.width },
                },
              }));
              return;
            }

            if (d.mode === 'stage-resize') {
              setMap((prev) => {
                const cur = prev.venue?.stage ?? { x: d.orig.x, y: stage.y, width: d.orig.width };
                if (d.side === 'right') {
                  return {
                    ...prev,
                    venue: { ...prev.venue, stage: { ...cur, width: Math.max(60, Math.round(d.orig.width + dx)) } },
                  };
                }
                const newWidth = Math.max(60, Math.round(d.orig.width - dx));
                const newX = Math.round(d.orig.x + (d.orig.width - newWidth));
                return { ...prev, venue: { ...prev.venue, stage: { ...cur, x: newX, width: newWidth } } };
              });
              return;
            }

            if (d.mode === 'furniture') {
              setMap((prev) => ({
                ...prev,
                venue: {
                  ...prev.venue,
                  furniture: (prev.venue?.furniture ?? []).map((f) =>
                    f.id === d.id ? { ...f, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) } : f,
                  ),
                },
              }));
              return;
            }

            if (d.mode === 'focus') {
              if (cadLocks.focusPoints) return;
              setMap((prev) => ({
                ...prev,
                venue: {
                  ...prev.venue,
                  focusPoints: (prev.venue?.focusPoints ?? []).map((f) =>
                    f.id === d.id
                      ? { ...f, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) }
                      : f,
                  ),
                },
              }));
            }
          }}
          onPointerUp={() => {
            // Cierre de la selección por rectángulo.
            const mq = marqueeRef.current;
            if (mq) {
              const box = marquee;
              marqueeRef.current = null;
              setMarquee(null);
              if (box) {
                const minX = Math.min(box.x0, box.x1);
                const minY = Math.min(box.y0, box.y1);
                const maxX = Math.max(box.x0, box.x1);
                const maxY = Math.max(box.y0, box.y1);
                // Un rectángulo diminuto es un clic en vacío, no una selección.
                if (maxX - minX > 2 || maxY - minY > 2) {
                  const hits = querySeatsInRect(seatIndex, minX, minY, maxX, maxY, []);
                  const next = mq.additive ? new Set(selected) : new Set<string>();
                  const activeLevel = levelFilter === 'ALL' ? null : levelFilter;
                  const levelIdx = activeLevel ? seatIndex.levels.indexOf(activeLevel) : -1;
                  for (const i of hits) {
                    // Respeta el filtro de nivel: no se selecciona lo que no se ve.
                    if (levelIdx >= 0) {
                      const li = seatIndex.levelIdx[i];
                      if (li !== 0xffff && li !== levelIdx) continue;
                    }
                    next.add(seatIndex.ids[i]);
                  }
                  setSelected(next);
                }
              }
              return;
            }

            const d = dragRef.current;
            if (d && d.mode === 'block') {
              const next = regenerateSeatsFromBlocks(mapRef.current, { sectionId: d.sectionId });
              pushHistory(next, 'Regenerar bloque');
              setSelected(EMPTY_SELECTION);
            } else if (d && d.mode === 'seat') {
              // Movimiento de butacas: comando compacto (posiciones previas), no clon.
              commit(mapRef.current, {
                kind: 'seat-move',
                label: `Mover ${d.seatIds.length} butaca(s)`,
                before: d.seatIds.map((id) => ({
                  id,
                  x: d.orig[id]?.x ?? 0,
                  y: d.orig[id]?.y ?? 0,
                })),
                dx: 0,
                dy: 0,
              });
            } else if (d && d.mode !== 'pan') {
              pushHistory(cloneMap(mapRef.current), 'Mover elemento');
            }
            dragRef.current = null;
          }}
        >
          {/*
            Capa de butacas sobre canvas. Va debajo del SVG estructural para que
            secciones, escenario, pasillos y salidas sigan siendo nodos del DOM
            (son pocos y necesitan interacción propia).
          */}
          <SeatCanvasLayer
            index={seatIndex}
            selected={selectedIdx}
            overlaps={overlapSeatIdx}
            sightlines={sightlineScores}
            levelFilter={levelFilter === 'ALL' ? null : levelFilter}
            scale={scale}
            tx={tx}
            ty={ty}
            width={viewportSize.width}
            height={viewportSize.height}
            marquee={marquee}
          />
          <svg
            className={styles.canvas}
            width="100%"
            height="100%"
            style={{ background: 'transparent', position: 'relative' }}
          >
            <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
              {/* Snap grid */}
              {snapEnabled && (
                <g opacity={0.22} pointerEvents="none">
                  {Array.from({
                    length: Math.ceil(bounds.width / snapPitch) + 1,
                  }).map((_, i) => {
                    const x = bounds.minX + i * snapPitch;
                    return (
                      <line
                        key={`vg-${i}`}
                        x1={x}
                        y1={bounds.minY}
                        x2={x}
                        y2={bounds.minY + bounds.height}
                        stroke="#52525b"
                        strokeWidth={0.5}
                      />
                    );
                  })}
                  {Array.from({
                    length: Math.ceil(bounds.height / snapPitch) + 1,
                  }).map((_, i) => {
                    const y = bounds.minY + i * snapPitch;
                    return (
                      <line
                        key={`hg-${i}`}
                        x1={bounds.minX}
                        y1={y}
                        x2={bounds.minX + bounds.width}
                        y2={y}
                        stroke="#52525b"
                        strokeWidth={0.5}
                      />
                    );
                  })}
                </g>
              )}

              {/* Section zone backdrops */}
              {visibleSections.map((sec) => {
                const pts = sectionBackdropPoints(sec);
                if (pts.length < 3) return null;
                return (
                  <polygon
                    key={`backdrop-${sec.id}`}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={sec.color}
                    fillOpacity={0.1}
                    stroke={sec.color}
                    strokeOpacity={0.4}
                    strokeWidth={1.2}
                    style={{
                      pointerEvents: tool === 'move-section' ? 'auto' : 'none',
                      cursor: tool === 'move-section' ? 'grab' : 'default',
                    }}
                    onPointerDown={(e) => handleSectionBackdropPointerDown(e, sec.id)}
                  />
                );
              })}

              {/* Stage */}
              <rect
                x={stage.x}
                y={stage.y}
                width={stage.width}
                height={22}
                rx={3}
                fill="#e11d48"
                onPointerDown={handleStagePointerDown}
                style={{ cursor: tool === 'select' ? 'move' : 'default' }}
              />
              <text
                x={stage.x + stage.width / 2}
                y={stage.y + 15}
                textAnchor="middle"
                fill="#fff"
                fontSize={11}
                fontWeight={700}
                letterSpacing={2}
                style={{ pointerEvents: 'none' }}
              >
                ESCENARIO
              </text>
              {(map.venue?.focusPoints ?? []).map((f) => {
                if (levelFilter !== 'ALL' && f.levelId && f.levelId !== levelFilter) return null;
                return (
                <g
                  key={f.id}
                  style={{ cursor: tool === 'focus' || tool === 'select' ? 'pointer' : 'default' }}
                  onPointerDown={(e) => {
                    if (tool !== 'focus' && tool !== 'select') return;
                    e.stopPropagation();
                    if (cadLocks.focusPoints) {
                      if (tool === 'focus') warnLocked('Los focos están bloqueados (CAD lock).');
                      return;
                    }
                    if (tool === 'focus') {
                      removeFocus(f.id);
                      return;
                    }
                    const world = clientToWorld(e.clientX, e.clientY);
                    dragRef.current = {
                      mode: 'focus',
                      id: f.id,
                      startX: world.x,
                      startY: world.y,
                      orig: { x: f.x, y: f.y },
                    };
                    (viewportRef.current as HTMLElement | null)?.setPointerCapture(e.pointerId);
                  }}
                >
                  <circle cx={f.x} cy={f.y} r={7} fill="rgba(250,250,250,0.9)" stroke="#e11d48" strokeWidth={2} />
                  <text
                    x={f.x}
                    y={f.y - 12}
                    textAnchor="middle"
                    fill="#fecdd3"
                    fontSize={9}
                    fontWeight={700}
                    style={{ pointerEvents: 'none' }}
                  >
                    {f.label ?? 'Foco'}
                  </text>
                </g>
                );
              })}
              {tool === 'select' && (
                <>
                  <rect
                    className={styles.stageHandle}
                    x={stage.x - 5}
                    y={stage.y - 4}
                    width={10}
                    height={30}
                    onPointerDown={(e) => handleStageResizePointerDown(e, 'left')}
                  />
                  <rect
                    className={styles.stageHandle}
                    x={stage.x + stage.width - 5}
                    y={stage.y - 4}
                    width={10}
                    height={30}
                    onPointerDown={(e) => handleStageResizePointerDown(e, 'right')}
                  />
                </>
              )}

              {/* Circulation graph overlay */}
              {circulation && circulationGraphView && (
                <g opacity={0.85} pointerEvents="none">
                  {circulationGraphView.edges.map((e) => {
                    const a = circulationGraphView.nodes.find((n) => n.id === e.from);
                    const b = circulationGraphView.nodes.find((n) => n.id === e.to);
                    if (!a || !b) return null;
                    const isBottleneck = bottleneckEdgeIds.has(e.id);
                    const stroke = isBottleneck
                      ? '#f43f5e'
                      : e.kind === 'stair'
                        ? '#fb923c'
                        : e.kind === 'access'
                          ? '#4ade80'
                          : e.kind === 'link'
                            ? '#94a3b8'
                            : '#67e8f9';
                    return (
                      <line
                        key={e.id}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={stroke}
                        strokeWidth={isBottleneck ? 5 : e.kind === 'aisle' ? 3 : 2}
                        strokeDasharray={e.kind === 'link' || e.kind === 'access' ? '4 3' : undefined}
                      />
                    );
                  })}
                  {circulationGraphView.nodes.map((n) => (
                    <circle
                      key={n.id}
                      cx={n.x}
                      cy={n.y}
                      r={n.kind === 'section' ? 6 : n.kind === 'stage' ? 8 : 4}
                      fill={
                        n.kind === 'stage'
                          ? '#e11d48'
                          : n.kind === 'exit'
                            ? '#22c55e'
                            : n.kind === 'section'
                              ? circulation.unreachableSections.includes(n.sectionId ?? '')
                                ? '#f97316'
                                : '#22c55e'
                              : n.kind === 'stair'
                                ? '#fb923c'
                                : '#67e8f9'
                      }
                      stroke="#0a0a0a"
                      strokeWidth={1}
                    />
                  ))}
                </g>
              )}

              {/* Block origin handles (select tool) */}
              {tool === 'select' &&
                visibleSections.flatMap((sec) =>
                  (sec.blocks ?? []).map((block) => (
                    <g
                      key={`block-h-${sec.id}-${block.id}`}
                      style={{ cursor: sec.locked ? 'not-allowed' : 'move' }}
                      onPointerDown={(e) =>
                        handleBlockPointerDown(e, sec.id, block.id, block.origin)
                      }
                    >
                      <rect
                        x={block.origin.x - 7}
                        y={block.origin.y - 7}
                        width={14}
                        height={14}
                        rx={2}
                        fill={sec.id === activeSection?.id ? '#fbbf24' : '#a1a1aa'}
                        stroke="#0a0a0a"
                        strokeWidth={1.5}
                      />
                      <title>{`Bloque ${block.label ?? block.id} — arrastra para mover`}</title>
                    </g>
                  )),
                )}

              {/* Section egress routes (+ bottlenecks) */}
              {showCirculation &&
                egressOverlay?.paths.map((path) => {
                  const active = path.sectionId === activeSection?.id;
                  if (active) return null; // drawn below as active polyline
                  return (
                    <polyline
                      key={`egress-${path.sectionId}`}
                      points={path.points.map(([x, y]) => `${x},${y}`).join(' ')}
                      fill="none"
                      stroke="rgba(244,114,182,0.35)"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="6 5"
                      opacity={0.55}
                      pointerEvents="none"
                    />
                  );
                })}
              {showCirculation &&
                egressOverlay?.bottlenecks.map((b) => (
                  <polyline
                    key={`bn-${b.edgeId}`}
                    points={b.points.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke="rgba(251,146,60,0.9)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    opacity={0.85}
                    pointerEvents="none"
                  />
                ))}

              {/* Active section egress path */}
              {showCirculation && activeEgressPath && (
                <polyline
                  points={activeEgressPath.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#f472b6"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="8 5"
                  opacity={0.95}
                  pointerEvents="none"
                />
              )}

              {/* Furniture (LED walls, speakers, doors) */}
              {furniture.map((item) => {
                if (levelFilter !== 'ALL' && item.levelId && item.levelId !== levelFilter) {
                  return null;
                }
                return (
                <FurnitureGlyph
                  key={item.id}
                  item={item}
                  selected={selectedFurnitureId === item.id}
                  onPointerDown={(e) => handleFurniturePointerDown(e, item)}
                />
                );
              })}

              {/* Section labels */}
              {visibleSections.map((sec) => {
                let cx: number;
                let cy: number;
                if (sec.seats.length) {
                  cx = sec.seats.reduce((n, s) => n + s.x, 0) / sec.seats.length;
                  cy = sec.seats.reduce((n, s) => n + s.y, 0) / sec.seats.length;
                } else if (sec.shape?.points?.length) {
                  cx = sec.shape.points.reduce((n, [x]) => n + x, 0) / sec.shape.points.length;
                  cy = sec.shape.points.reduce((n, [, y]) => n + y, 0) / sec.shape.points.length;
                } else {
                  return null;
                }
                return (
                  <g key={`label-${sec.id}`} transform={`translate(${cx} ${cy})`} style={{ pointerEvents: 'none' }}>
                    <rect
                      x={-40}
                      y={-10}
                      width={80}
                      height={18}
                      rx={9}
                      fill="rgba(0,0,0,0.7)"
                      stroke={sec.color}
                      strokeOpacity={0.85}
                    />
                    <text
                      y={3.5}
                      textAnchor="middle"
                      fill={sec.color}
                      fontSize={9}
                      fontWeight={700}
                    >
                      {sec.name}
                    </text>
                  </g>
                );
              })}

              {/* Authored aisles / obstacles */}
              {aisles.map((a) => {
                if (levelFilter !== 'ALL' && a.levelId && a.levelId !== levelFilter) return null;
                return (
                <polyline
                  key={a.id}
                  points={a.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(148,163,184,0.45)"
                  strokeWidth={a.width ?? 24}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                );
              })}
              {obstacles.map((o) => {
                if (levelFilter !== 'ALL' && o.levelId && o.levelId !== levelFilter) return null;
                return (
                <polygon
                  key={o.id}
                  points={o.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="rgba(63,63,70,0.55)"
                  stroke="rgba(161,161,170,0.55)"
                  strokeWidth={1}
                />
                );
              })}
              {stairs.map((s) => {
                if (
                  levelFilter !== 'ALL' &&
                  s.fromLevelId &&
                  s.toLevelId &&
                  s.fromLevelId !== levelFilter &&
                  s.toLevelId !== levelFilter
                ) {
                  return null;
                }
                return (
                <polyline
                  key={s.id}
                  points={s.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(251,146,60,0.75)"
                  strokeWidth={s.width ?? 28}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="10 6"
                />
                );
              })}
              {exits.map((ex) => {
                if (levelFilter !== 'ALL' && ex.levelId && ex.levelId !== levelFilter) return null;
                const pts = ex.points;
                if (!pts.length) return null;
                const [x, y] = pts[0];
                return (
                  <g
                    key={ex.id}
                    style={{ cursor: tool === 'exit' || tool === 'select' ? 'pointer' : 'default' }}
                    onPointerDown={(e) => {
                      if (tool !== 'exit') return;
                      e.stopPropagation();
                      removeExit(ex.id);
                    }}
                  >
                    {pts.length >= 2 ? (
                      <polyline
                        points={pts.map(([px, py]) => `${px},${py}`).join(' ')}
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth={ex.width ?? 32}
                        strokeLinecap="round"
                        opacity={0.7}
                      />
                    ) : null}
                    <circle
                      cx={x}
                      cy={y}
                      r={Math.max((ex.width ?? 32) * 0.35, 8)}
                      fill="rgba(34,197,94,0.85)"
                      stroke="#14532d"
                      strokeWidth={2}
                    />
                    <text
                      x={x}
                      y={y - 14}
                      textAnchor="middle"
                      fill="#bbf7d0"
                      fontSize={9}
                      fontWeight={700}
                      style={{ pointerEvents: 'none' }}
                    >
                      {ex.label ?? 'Salida'}
                    </text>
                  </g>
                );
              })}

              {/* GA zone being drawn */}
              {tool === 'ga' && gaDraft.length > 0 && (
                <>
                  <polyline
                    points={gaDraft.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                  {gaDraft.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4} fill="#f59e0b" />
                  ))}
                </>
              )}

              {(tool === 'aisle' || tool === 'obstacle' || tool === 'stairs') && polyDraft.length > 0 && (
                <>
                  <polyline
                    points={polyDraft.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={
                      tool === 'aisle' ? '#94a3b8' : tool === 'stairs' ? '#fb923c' : '#a1a1aa'
                    }
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                  {polyDraft.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={4}
                      fill={tool === 'aisle' ? '#94a3b8' : tool === 'stairs' ? '#fb923c' : '#a1a1aa'}
                    />
                  ))}
                </>
              )}

              {/*
                Las butacas ya no se dibujan en SVG: a 45.000 asientos eran
                ~180.000 nodos del DOM. Ahora viven en <SeatCanvasLayer>, que se
                monta fuera del <svg> y se pinta debajo de lo estructural.
              */}
            </g>
          </svg>
          <p className={styles.hint}>
            {seatCount.toLocaleString('es-MX')} asientos · {map.sections.length} zonas ·{' '}
            {lodLabel} · zoom rueda · arrastra en vacío para seleccionar por área ·
            Delete · Ctrl+Z · Shift multi
            {selected.size ? ` · ${selected.size.toLocaleString('es-MX')} sel.` : ''}
            {analyzing ? ' · analizando…' : ''}
            {accessibility.capacity > 0 && (
              <span
                title={
                  accessibility.compliant
                    ? 'Cumple el cupo de plazas accesibles'
                    : `Faltan plazas accesibles o acompañantes (${accessibility.wheelchairSpaces}/${accessibility.requiredWheelchairSpaces})`
                }
                style={{ color: accessibility.compliant ? '#22c55e' : '#f59e0b' }}
              >
                {' '}
                · ♿ {accessibility.wheelchairSpaces}/{accessibility.requiredWheelchairSpaces}
              </span>
            )}
            {tool === 'ga' ? ' · click para agregar vértices, doble-click o Enter para cerrar' : ''}
            {tool === 'focus' ? ' · click para colocar foco · click en un foco para borrarlo' : ''}
            {tool === 'exit' ? ' · click para colocar salida · click en una salida para borrarla' : ''}
          </p>
        </div>
      </div>

      {cadReview && (
        <div className={styles.cadModalBackdrop} role="dialog" aria-modal="true" aria-label="Revisar import CAD">
          <div className={styles.cadModal}>
            <header className={styles.cadModalHeader}>
              <div>
                <h2>Revisar import {cadReview.source.toUpperCase()}</h2>
                <p>
                  {cadReview.filename} · {cadReview.rows.length} entidades
                </p>
              </div>
              <button type="button" onClick={() => setCadReview(null)}>
                Cerrar
              </button>
            </header>

            <div className={styles.cadModalToolbar}>
              <label>
                Modo
                <select
                  value={cadReview.mode}
                  onChange={(e) =>
                    setCadReview((prev) =>
                      prev
                        ? { ...prev, mode: e.target.value as 'merge' | 'replace-meta' }
                        : prev,
                    )
                  }
                >
                  <option value="merge">Fusionar con mapa actual</option>
                  <option value="replace-meta">Reemplazar meta (pasillos/shapes)</option>
                </select>
              </label>
              <button type="button" onClick={resetCadReviewRoles}>
                Restaurar heurística
              </button>
              <button type="button" onClick={() => setAllCadReviewRole('skip')}>
                Omitir todos
              </button>
            </div>
            {activeCadLockLabels(map.venue?.cadLocks).length > 0 && (
              <p className={styles.sideHint} style={{ margin: '0 1rem 0.5rem' }}>
                CAD locks activos: {activeCadLockLabels(map.venue?.cadLocks).join(', ')}. Esas
                capas no se importan ni se borran en modo reemplazar.
              </p>
            )}

            <div className={styles.cadModalTableWrap}>
              <table className={styles.cadModalTable}>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Origen</th>
                    <th>Pts</th>
                    <th>Sugerido</th>
                    <th>Rol</th>
                  </tr>
                </thead>
                <tbody>
                  {cadReview.rows.map((row) => (
                    <tr key={row.id} className={row.role === 'skip' ? styles.cadRowSkip : undefined}>
                      <td title={row.id}>{row.name}</td>
                      <td>
                        <code>{row.source ?? '—'}</code>
                      </td>
                      <td>{row.pointCount}</td>
                      <td>{CAD_ROLE_LABELS[row.suggestedRole]}</td>
                      <td>
                        <select
                          value={row.role}
                          onChange={(e) =>
                            patchCadReviewRole(row.id, e.target.value as CadEntityRole)
                          }
                        >
                          {CAD_ENTITY_ROLES.map((role) => (
                            <option
                              key={role}
                              value={role}
                              disabled={
                                role !== 'skip' && isCadRoleLocked(role, map.venue?.cadLocks)
                              }
                            >
                              {CAD_ROLE_LABELS[role]}
                              {role !== 'skip' && isCadRoleLocked(role, map.venue?.cadLocks)
                                ? ' (lock)'
                                : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className={styles.cadModalFooter}>
              <button type="button" onClick={() => setCadReview(null)}>
                Cancelar
              </button>
              <button type="button" className={styles.cadApplyBtn} onClick={applyCadReview}>
                Aplicar al mapa
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
