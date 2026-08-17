'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SEAT_STATUS_COLORS,
  flatSeats,
  normalizeSeatMap,
  priceHeatColor,
  sightlineHeatColor,
  calculateSightlines,
  projectTo2D,
  resolveGeometry,
  resolveOfferForSection,
  sectionBounds,
  buildEgressPathOverlays,
} from '@boletera/venue-engine';
import { useInventoryFeed } from '@/hooks/useInventoryFeed';
import { useMapGestures } from '@/hooks/useMapGestures';
import { AccessibleSeatPicker } from './seatmap/AccessibleSeatPicker';
import { buildSectionShapes, pointInPolygon } from './seatmap/section-shapes';
import {
  drawSeatLayer,
  drawSectionLayer,
  mixColor,
  prepareCanvas,
  resolveDpr,
  type CanvasSize,
  type SectionPaint,
} from './seatmap/seat-renderer';
import {
  buildSeatGrid,
  estimateSeatPitch,
  findNearestSeat,
  type SeatGrid,
} from './seatmap/spatial-index';
import type { RenderSeat, SeatStatus, ViewTransform } from './seatmap/types';
import styles from './SeatMapViewer.module.scss';

/**
 * Visor de butacas para recintos grandes (45.000 plazas, mayoría móvil 4G).
 *
 * ARQUITECTURA DE RENDER — SVG para lo estructural, canvas para lo masivo:
 *
 *   svg (base)     escenario, pasillos, obstáculos, escaleras, mobiliario
 *   canvas #1      polígonos de sección (capa «estática»: no la tocan los deltas)
 *   canvas #2      butacas
 *   svg (overlay)  salidas, rutas de egress, focos
 *
 * Antes había un `<circle>` por butaca: 45.000 nodos de DOM, que en un móvil de
 * gama media significa varios segundos de layout y un scroll inservible. Con
 * canvas el coste por frame lo marca lo que se ve, no el aforo.
 *
 * Y por debajo de un umbral de zoom NO se dibujan butacas: se pinta un polígono
 * por sección teñido por ocupación (~30 formas). Eso es lo que hace que el
 * recinto completo sea viable; las butacas aparecen al acercarse, que es
 * justamente cuando se pueden tocar.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** Por debajo de esto una butaca es un píxel de ruido: se pinta la sección. */
const MIN_SEAT_PX = 3.5;
/** A partir de aquí caben los números de butaca. */
const LABEL_SEAT_PX = 17;
/**
 * Selección por toque sólo cuando la butaca mide ≥24 px: es el mínimo de
 * objetivo táctil de WCAG 2.2 (2.5.8). Más alejado, tocar NAVEGA (acerca la
 * zona) en vez de seleccionar; y para seleccionar sin zoom está el selector
 * accesible, que es el «control equivalente» que admite el criterio.
 */
const SELECT_SEAT_PX = 24;
/** Radio de toque en px CSS: 12 de radio = objetivo de 24×24. */
const TOUCH_RADIUS_PX = 12;
/**
 * El heat de vista raycastea butaca a butaca: por encima de esto bloquea el
 * hilo principal durante segundos. Se deshabilita en recintos grandes.
 */
const SIGHTLINE_MAX_SEATS = 12_000;
/** Duración del latido de una butaca perdida en un 409. */
const CONFLICT_PULSE_MS = 6000;

type Offer = { id: string; zone: string; name?: string; basePrice: string };

export type SelectedSeatInfo = {
  seatId: string;
  label: string;
  sectionName: string;
  sectionSlug: string;
  price: number;
  offerId: string;
};

/**
 * `accessible` vive en `Seat` (BD) pero todavía no está tipado en
 * `SeatMapSeat` del snapshot, así que se lee de las formas en que hoy puede
 * llegar. Ver nota de entrega: en cuanto `packages/shared` lo tipe, esto se
 * queda en una sola línea.
 */
function readAccessible(
  seat: { tier?: string; metadata?: Record<string, unknown> },
  sectionIsAccessible: boolean,
): boolean {
  const meta = seat.metadata;
  if (meta) {
    if (typeof meta.accessible === 'boolean') return meta.accessible;
    if (meta.wheelchair === true || meta.pmr === true) return true;
  }
  const raw = (seat as { accessible?: unknown }).accessible;
  if (typeof raw === 'boolean') return raw;
  const tier = String(seat.tier ?? '').toLowerCase();
  if (tier === 'accessible' || tier === 'pmr' || tier === 'wheelchair') return true;
  return sectionIsAccessible;
}

const ACCESSIBLE_NAME = /accesib|pmr|movilidad|silla de ruedas|wheelchair/i;

function shorten(text: string, max = 16): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function SeatMapViewer({
  eventId,
  mapData,
  selected,
  onToggle,
  onClear,
  offers = [],
  maxSelect = 8,
  currency = 'MXN',
  heatDefault = false,
  focusZone,
  conflictSeatIds,
  resyncToken = 0,
}: {
  eventId: string;
  mapData: unknown;
  selected: string[];
  onToggle: (seatId: string) => void;
  onClear?: () => void;
  offers?: Offer[];
  maxSelect?: number;
  currency?: string;
  heatDefault?: boolean;
  /** Offer zone / section slug to pre-filter the map */
  focusZone?: string | null;
  /** Butacas perdidas en un 409: se señalan en el mapa en vez de fallar en silencio. */
  conflictSeatIds?: readonly string[];
  /** Cambiar este número fuerza una resincronización del inventario. */
  resyncToken?: number;
}) {
  // ---------------------------------------------------------------------------
  // Geometría (idéntica a la versión SVG: aquí no se re-maqueta nada)
  // ---------------------------------------------------------------------------
  const map = useMemo(() => normalizeSeatMap(mapData), [mapData]);
  const scene = useMemo(() => resolveGeometry(map), [map]);
  const projected = useMemo(() => projectTo2D(scene), [scene]);
  const bounds = useMemo(() => projected.bounds, [projected.bounds]);

  const sectionMeta = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; accessible: boolean }>();
    for (const sec of map.sections) {
      m.set(sec.id, {
        slug: sec.slug,
        name: sec.name,
        accessible: ACCESSIBLE_NAME.test(`${sec.slug} ${sec.name}`),
      });
    }
    return m;
  }, [map.sections]);

  const priceOf = useCallback(
    (sectionId: string) => {
      const meta = sectionMeta.get(sectionId);
      const offer = resolveOfferForSection(offers, meta?.slug ?? '', meta?.name);
      return offer ? Number(offer.basePrice) : 0;
    },
    [offers, sectionMeta],
  );

  const offerIdOf = useCallback(
    (sectionId: string) => {
      const meta = sectionMeta.get(sectionId);
      return resolveOfferForSection(offers, meta?.slug ?? '', meta?.name)?.id ?? '';
    },
    [offers, sectionMeta],
  );

  /**
   * Array plano de butacas listas para pintar. Todo lo caro (precio, oferta,
   * accesibilidad) se resuelve UNA vez aquí; el bucle de dibujo sólo lee.
   */
  const seats: RenderSeat[] = useMemo(() => {
    const byId = new Map(flatSeats(scene.map).map((s) => [s.id, s]));
    return projected.seats.map((p) => {
      const full = byId.get(p.id);
      const meta = sectionMeta.get(p.sectionId);
      return {
        id: p.id,
        sectionId: p.sectionId,
        sectionName: full?.sectionName ?? meta?.name ?? p.sectionId,
        levelId: p.levelId ?? full?.levelId,
        x: p.x,
        y: p.y,
        rotation: p.rotation ?? 0,
        label: p.label,
        row: p.row ?? full?.row,
        color: p.color || SEAT_STATUS_COLORS.available,
        accessible: readAccessible(
          { tier: p.tier, metadata: full?.metadata },
          meta?.accessible ?? false,
        ),
        blocked: Boolean(p.visibility?.blocked),
        restricted: Boolean(p.visibility?.restrictedView),
        premium: Boolean(p.visibility?.premiumView),
        price: priceOf(p.sectionId),
        offerId: offerIdOf(p.sectionId),
      } satisfies RenderSeat;
    });
  }, [projected.seats, scene.map, sectionMeta, priceOf, offerIdOf]);

  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < seats.length; i++) m.set(seats[i].id, i);
    return m;
  }, [seats]);

  const seatIndexesBySection = useMemo(() => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < seats.length; i++) {
      const list = m.get(seats[i].sectionId);
      if (list) list.push(i);
      else m.set(seats[i].sectionId, [i]);
    }
    return m;
  }, [seats]);

  const seatPitch = useMemo(() => estimateSeatPitch(seats.length, bounds), [seats.length, bounds]);
  const grid: SeatGrid = useMemo(() => buildSeatGrid(seats, bounds), [seats, bounds]);
  const sectionShapes = useMemo(
    () => buildSectionShapes(map.sections, seats, seatPitch),
    [map.sections, seats, seatPitch],
  );

  const stage = useMemo(() => {
    if (projected.stage) return projected.stage;
    const width = bounds.width * 0.42;
    return { x: bounds.minX + (bounds.width - width) / 2, y: bounds.minY - 34, width };
  }, [projected.stage, bounds]);

  // ---------------------------------------------------------------------------
  // Estado de UI
  // ---------------------------------------------------------------------------
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [sectionFilter, setSectionFilter] = useState<string | 'ALL'>('ALL');
  const [heatMode, setHeatMode] = useState<'off' | 'price' | 'view'>(heatDefault ? 'price' : 'off');
  const [showEgress, setShowEgress] = useState(false);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [viewScale, setViewScale] = useState(1);
  const [panning, setPanning] = useState(false);
  const [ready, setReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const feed = useInventoryFeed(eventId);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const conflictIndexes = useMemo(
    () =>
      (conflictSeatIds ?? [])
        .map((id) => indexById.get(id) ?? -1)
        .filter((i) => i >= 0),
    [conflictSeatIds, indexById],
  );
  const conflictUntilRef = useRef(0);

  const priceRange = useMemo(() => {
    const prices = map.sections.map((s) => priceOf(s.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [map.sections, priceOf]);

  useEffect(() => {
    if (priceCap == null && priceRange.max > 0) setPriceCap(priceRange.max);
  }, [priceRange.max, priceCap]);

  const feedResync = feed.resync;
  useEffect(() => {
    if (!resyncToken) return;
    feedResync();
  }, [resyncToken, feedResync]);

  const sightlineBySeat = useMemo(() => {
    if (heatMode !== 'view' || seats.length > SIGHTLINE_MAX_SEATS) return null;
    const result = calculateSightlines(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    return new Map(result.scores.map((s) => [s.seatId, s.score]));
  }, [heatMode, scene, levelFilter, seats.length]);

  const egressOverlay = useMemo(() => {
    if (!showEgress) return null;
    return buildEgressPathOverlays(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, scene, levelFilter]);

  const levels = useMemo(() => {
    const list = [...(map.venue?.levels ?? [])];
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }, [map.venue?.levels]);

  const visibleSections = useMemo(() => {
    if (levelFilter === 'ALL') return map.sections;
    return map.sections.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [map.sections, levelFilter]);

  const highlightEgressSectionId = useMemo(() => {
    if (!egressOverlay?.paths.length) return null;
    if (sectionFilter !== 'ALL') return sectionFilter;
    if (selected.length) {
      const idx = indexById.get(selected[0]);
      if (idx != null) return seats[idx].sectionId;
    }
    return egressOverlay.paths[0]?.sectionId ?? null;
  }, [egressOverlay, sectionFilter, selected, indexById, seats]);

  useEffect(() => {
    if (!focusZone) return;
    const needle = focusZone.toLowerCase();
    const match = map.sections.find(
      (s) =>
        s.slug.toLowerCase() === needle ||
        s.name.toLowerCase() === needle ||
        s.name.toLowerCase().includes(needle) ||
        s.slug.toLowerCase().includes(needle),
    );
    if (match) setSectionFilter(match.id);
  }, [focusZone, map.sections]);

  // ---------------------------------------------------------------------------
  // Estado por butaca
  // ---------------------------------------------------------------------------
  const statusAt = useCallback(
    (index: number): SeatStatus => {
      const seat = seats[index];
      if (selectedSet.has(seat.id)) return 'selected';
      if (seat.blocked) return 'blocked';
      return feed.statusRef.current.get(seat.id) ?? 'unknown';
    },
    [seats, selectedSet, feed.statusRef],
  );

  const dimmedAt = useCallback(
    (index: number): boolean => {
      const seat = seats[index];
      if (levelFilter !== 'ALL' && (seat.levelId ?? '') !== levelFilter) return true;
      if (sectionFilter !== 'ALL' && seat.sectionId !== sectionFilter) return true;
      if (priceCap != null && seat.price > priceCap) return true;
      if (accessibleOnly && !seat.accessible) return true;
      return false;
    },
    [seats, levelFilter, sectionFilter, priceCap, accessibleOnly],
  );

  const fillAt = useCallback(
    (index: number, status: SeatStatus, dimmed: boolean): string => {
      const seat = seats[index];
      if (status === 'selected') return SEAT_STATUS_COLORS.selected;
      if (dimmed) return SEAT_STATUS_COLORS.dimmed;
      if (status === 'unknown') return '#52525b';
      if (status === 'blocked') return '#3f3f46';
      if (status === 'sold') return SEAT_STATUS_COLORS.sold;
      if (status === 'held') return SEAT_STATUS_COLORS.held;
      if (heatMode === 'price') return priceHeatColor(seat.price, priceRange.min, priceRange.max);
      if (heatMode === 'view') {
        const score = sightlineBySeat?.get(seat.id);
        if (score != null) return sightlineHeatColor(score);
      }
      if (seat.accessible) return '#22d3ee';
      if (seat.premium) return '#d4a017';
      return seat.color || SEAT_STATUS_COLORS.available;
    },
    [seats, heatMode, priceRange.min, priceRange.max, sightlineBySeat],
  );

  /**
   * Conteos globales + por sección en UNA sola pasada.
   * Se recalcula con `feed.version`, que llega agrupado (máx. 5 veces/s), así
   * que el barrido de 45.000 butacas ocurre como mucho 5 veces por segundo y
   * no una vez por delta.
   */
  const derived = useMemo(() => {
    const statuses = feed.statusRef.current;
    let available = 0;
    let held = 0;
    let sold = 0;
    let accessibleFree = 0;
    const bySection = new Map<string, { free: number; total: number }>();

    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      const status: SeatStatus = selectedSet.has(seat.id)
        ? 'selected'
        : seat.blocked
          ? 'blocked'
          : statuses.get(seat.id) ?? 'unknown';

      const stat = bySection.get(seat.sectionId) ?? { free: 0, total: 0 };
      stat.total += 1;
      if (status === 'available') stat.free += 1;
      bySection.set(seat.sectionId, stat);

      if (dimmedAt(i)) continue;
      if (status === 'available') {
        available += 1;
        if (seat.accessible) accessibleFree += 1;
      } else if (status === 'held') held += 1;
      else if (status === 'sold' || status === 'blocked') sold += 1;
    }
    return { counts: { available, held, sold, accessibleFree }, bySection };
    // `feed.version` no se usa dentro pero es la señal de que statusRef cambió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, selectedSet, dimmedAt, feed.version]);

  const sectionPaints: SectionPaint[] = useMemo(() => {
    return sectionShapes.map((shape) => {
      const stat = derived.bySection.get(shape.id) ?? { free: 0, total: shape.seatCount };
      const occupancy = stat.total ? 1 - stat.free / stat.total : 1;
      const base =
        heatMode === 'price'
          ? priceHeatColor(priceOf(shape.id), priceRange.min, priceRange.max)
          : shape.color;
      const dimmed =
        (levelFilter !== 'ALL' && (shape.levelId ?? '') !== levelFilter) ||
        (sectionFilter !== 'ALL' && sectionFilter !== shape.id);
      const price = priceOf(shape.id);
      return {
        shape,
        // Cuanto más llena, más se apaga hacia el gris del fondo.
        fill: mixColor(base, '#27272a', occupancy * 0.8),
        outline: base,
        dimmed,
        title: shorten(shape.name),
        subtitle:
          stat.free > 0
            ? `${stat.free} libres${price ? ` · $${price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : ''}`
            : 'Agotada',
        // Trama diagonal además del color: el «agotado» no puede depender solo
        // del tono (WCAG 1.4.1).
        hatched: stat.total > 0 && stat.free === 0,
      } satisfies SectionPaint;
    });
  }, [
    sectionShapes,
    derived.bySection,
    heatMode,
    priceOf,
    priceRange.min,
    priceRange.max,
    levelFilter,
    sectionFilter,
  ]);

  // ---------------------------------------------------------------------------
  // Canvas + gestos
  // ---------------------------------------------------------------------------
  const sectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const seatCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgBaseGroupRef = useRef<SVGGElement>(null);
  const svgOverlayGroupRef = useRef<SVGGElement>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const sectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const seatCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** Firma del último pintado de la capa de secciones (para no repetirlo). */
  const sectionSigRef = useRef('');

  /** Todo lo que necesita el frame, en un ref: el rAF no debe cerrar sobre el render. */
  const drawRef = useRef({
    seats,
    grid,
    sectionPaints,
    statusAt,
    dimmedAt,
    fillAt,
    seatPitch,
    focusedIndex,
    conflictIndexes,
    accessibleOnly,
  });
  drawRef.current = {
    seats,
    grid,
    sectionPaints,
    statusAt,
    dimmedAt,
    fillAt,
    seatPitch,
    focusedIndex,
    conflictIndexes,
    accessibleOnly,
  };

  const gesturesRef = useRef<{ requestFrame: () => void } | null>(null);
  /** Última tanda de polígonos pintada: si no cambió, la capa no se repinta. */
  const lastPaintsRef = useRef<SectionPaint[] | null>(null);

  const draw = useCallback((view: ViewTransform) => {
    const size = sizeRef.current;
    if (!size.width || !size.height) return;
    const st = drawRef.current;

    // Los SVG se mueven con el mismo transform, aplicado a mano: pasarlo por
    // estado de React costaría un render por frame de arrastre.
    const transform = `translate(${view.tx} ${view.ty}) scale(${view.scale})`;
    svgBaseGroupRef.current?.setAttribute('transform', transform);
    svgOverlayGroupRef.current?.setAttribute('transform', transform);

    const seatPx = st.seatPitch * view.scale * 0.86;
    const showSeats = seatPx >= MIN_SEAT_PX;

    // Capa de secciones. Se repinta cuando cambia la transformación o los
    // filtros; con un delta del SSE sólo se repinta si las zonas SON la vista
    // (zoom bajo), porque ahí el «N libres» es la información principal.
    // Cuando ya se ven butacas, la mancha de zona es fondo al 22 % de opacidad
    // y no merece 30 polígonos + texto por cada cambio de estado: en ese caso
    // el delta toca únicamente la capa de butacas.
    const sig = `${view.scale.toFixed(4)}|${Math.round(view.tx)}|${Math.round(view.ty)}|${showSeats ? 1 : 0}|${size.width}x${size.height}`;
    const transformChanged = sig !== sectionSigRef.current;
    const paintsChanged = st.sectionPaints !== lastPaintsRef.current;
    const sectionCtx = sectionCtxRef.current;
    if (sectionCtx && (transformChanged || (paintsChanged && !showSeats))) {
      sectionSigRef.current = sig;
      lastPaintsRef.current = st.sectionPaints;
      drawSectionLayer(sectionCtx, size, view, st.sectionPaints, {
        showLabels: !showSeats || seatPx < LABEL_SEAT_PX,
        faded: showSeats,
      });
    }

    const seatCtx = seatCtxRef.current;
    if (!seatCtx) return;
    if (!showSeats) {
      seatCtx.clearRect(0, 0, size.width, size.height);
      return;
    }

    const now = performance.now();
    const conflictActive = now < conflictUntilRef.current && st.conflictIndexes.length > 0;
    drawSeatLayer(seatCtx, size, view, {
      seats: st.seats,
      grid: st.grid,
      statusAt: st.statusAt,
      dimmedAt: st.dimmedAt,
      fillAt: st.fillAt,
      seatPx,
      focusedIndex: st.focusedIndex,
      conflictIndexes: conflictActive ? st.conflictIndexes : [],
      conflictPhase: (now % 1200) / 1200,
      accessibleOnly: st.accessibleOnly,
      showLabels: seatPx >= LABEL_SEAT_PX,
    });
    // El latido del conflicto necesita frames continuos mientras dura.
    if (conflictActive) gesturesRef.current?.requestFrame();
  }, []);

  const minScale = useMemo(() => {
    // Nunca por debajo de lo que hace falta para ver el recinto entero.
    const fit = Math.min(1, 320 / Math.max(bounds.width, bounds.height));
    return Math.max(fit * 0.5, 0.02);
  }, [bounds.width, bounds.height]);

  const maxScale = useMemo(() => {
    // Siempre alcanzable el doble del umbral de selección, sea cual sea la
    // escala de las unidades del mapa.
    return Math.max(4, (SELECT_SEAT_PX * 2) / (seatPitch * 0.86));
  }, [seatPitch]);

  /**
   * Los handlers necesitan `gestures` y `gestures` necesita los handlers.
   * Se rompe el ciclo con un ref: el hook recibe envoltorios estables y aquí
   * abajo se rellenan con las versiones frescas de cada render.
   */
  const handlersRef = useRef<{
    tap: (x: number, y: number) => void;
    hover: (x: number, y: number) => void;
  }>({ tap: () => undefined, hover: () => undefined });

  const gestures = useMapGestures({
    minScale,
    maxScale,
    onFrame: draw,
    onTap: (x, y) => handlersRef.current.tap(x, y),
    onDoubleTap: (x, y) => gestures.zoomBy(2.2, x, y, true),
    onHover: (x, y) => handlersRef.current.hover(x, y),
    onHoverEnd: () => setFocusedIndex(-1),
    onScaleChange: setViewScale,
    onPanningChange: setPanning,
  });
  gesturesRef.current = gestures;

  const handleHover = useCallback(
    (clientX: number, clientY: number) => {
      const world = gestures.toWorld(clientX, clientY);
      if (!world) return;
      const view = gestures.viewRef.current;
      const seatPx = seatPitch * view.scale * 0.86;
      if (seatPx < MIN_SEAT_PX) return;
      const radius = Math.max(seatPx / 2, 6) / view.scale;
      const idx = findNearestSeat(grid, seats, world.x, world.y, radius);
      setFocusedIndex((prev) => (prev === idx ? prev : idx));
      gestures.requestFrame();
    },
    [grid, seats, seatPitch, gestures],
  );

  const selectSection = useCallback(
    (id: string | 'ALL') => {
      setSectionFilter(id);
      if (id === 'ALL') {
        gestures.fitRect(bounds, 28, true);
        return;
      }
      const sec = map.sections.find((s) => s.id === id);
      if (sec) gestures.fitRect(sectionBounds(sec, 28), 28, true);
    },
    [bounds, map.sections, gestures],
  );

  const tryToggle = useCallback(
    (index: number) => {
      const seat = seats[index];
      const status = statusAt(index);
      if (selectedSet.has(seat.id)) {
        onToggle(seat.id);
        setStatusMessage(`Quitaste ${seat.label}${seat.row ? ` de la fila ${seat.row}` : ''}.`);
        return;
      }
      if (status === 'unknown') {
        setStatusMessage('Todavía estamos confirmando esa butaca. Espera un momento e inténtalo.');
        return;
      }
      if (status !== 'available') {
        setStatusMessage(
          status === 'held'
            ? 'Esa butaca está apartada por otro comprador ahora mismo. Elige otra.'
            : 'Esa butaca ya no está disponible. Elige otra.',
        );
        return;
      }
      if (selected.length >= maxSelect) {
        setStatusMessage(`Máximo ${maxSelect} butacas por compra. Quita alguna para elegir otra.`);
        return;
      }
      onToggle(seat.id);
      setStatusMessage(
        `${seat.row ? `Fila ${seat.row}, ` : ''}butaca ${seat.label}, ${seat.sectionName}, $${seat.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}. Agregada.`,
      );
    },
    [seats, statusAt, selectedSet, selected.length, maxSelect, onToggle, currency],
  );

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      const world = gestures.toWorld(clientX, clientY);
      if (!world) return;
      const view = gestures.viewRef.current;
      const seatPx = seatPitch * view.scale * 0.86;

      if (seatPx >= SELECT_SEAT_PX) {
        // Radio de toque mayor que el radio dibujado: el objetivo real son
        // 24×24 px aunque la butaca se pinte más pequeña.
        const radius = Math.max(seatPx / 2, TOUCH_RADIUS_PX) / view.scale;
        const idx = findNearestSeat(grid, seats, world.x, world.y, radius, (i) => !dimmedAt(i));
        if (idx >= 0) {
          setFocusedIndex(idx);
          tryToggle(idx);
          gestures.requestFrame();
        }
        // Con zoom suficiente, tocar el hueco entre butacas no hace nada: un
        // reencuadre aquí alejaría el mapa justo cuando el usuario está
        // eligiendo, que es la peor sorpresa posible.
        return;
      }

      // Demasiado alejado para un objetivo táctil honesto (24×24 px): el toque
      // NAVEGA en vez de seleccionar. Para elegir sin acercarse está la lista.
      const hit = sectionShapes.find((s) => pointInPolygon(world.x, world.y, s.points));
      if (hit) {
        selectSection(hit.id);
        setStatusMessage(`Zona ${hit.name}. Acércate para elegir butaca, o usa la lista de abajo.`);
      } else {
        gestures.zoomBy(1.8, clientX, clientY, true);
      }
    },
    [grid, seats, seatPitch, dimmedAt, tryToggle, sectionShapes, selectSection, gestures],
  );

  handlersRef.current = { tap: handleTap, hover: handleHover };

  // Tamaño real del viewport (flex suele reportar 0 en el primer paint).
  useEffect(() => {
    const el = gestures.containerRef.current;
    if (!el) return;
    const apply = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      const dpr = resolveDpr();
      sizeRef.current = { width, height, dpr };
      if (sectionCanvasRef.current) {
        sectionCtxRef.current = prepareCanvas(sectionCanvasRef.current, sizeRef.current);
      }
      if (seatCanvasRef.current) {
        seatCtxRef.current = prepareCanvas(seatCanvasRef.current, sizeRef.current);
      }
      sectionSigRef.current = '';
      if (!ready) {
        gestures.fitRect(bounds, 28, false);
        setReady(true);
      }
      gestures.requestFrame();
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, ready]);

  // Cualquier cambio de datos o filtros pide un frame; el rAF hace el resto.
  useEffect(() => {
    gestures.requestFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.version, sectionPaints, focusedIndex, selectedSet, accessibleOnly, heatMode, priceCap]);

  // Butaca perdida en un 409: se centra, late y se anuncia.
  useEffect(() => {
    if (!conflictIndexes.length) return;
    conflictUntilRef.current = performance.now() + CONFLICT_PULSE_MS;
    const seat = seats[conflictIndexes[0]];
    gestures.centerOn(seat.x, seat.y, Math.max(gestures.viewRef.current.scale, maxScale * 0.6), true);
    setFocusedIndex(conflictIndexes[0]);
    setStatusMessage(
      `Otro comprador apartó ${seat.row ? `la fila ${seat.row}, ` : ''}butaca ${seat.label}. La marcamos en el mapa: elige otra.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictIndexes, seats, maxScale]);

  // ---------------------------------------------------------------------------
  // Teclado sobre el mapa (paneo/zoom). La SELECCIÓN con teclado vive en el
  // selector accesible: un canvas no puede exponer 45.000 objetivos de foco.
  // ---------------------------------------------------------------------------
  const onMapKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 120 : 48;
      const view = gestures.viewRef.current;
      switch (e.key) {
        case 'ArrowLeft':
          view.tx += step;
          break;
        case 'ArrowRight':
          view.tx -= step;
          break;
        case 'ArrowUp':
          view.ty += step;
          break;
        case 'ArrowDown':
          view.ty -= step;
          break;
        case '+':
        case '=':
          gestures.zoomBy(1.25, undefined, undefined, true);
          return;
        case '-':
        case '_':
          gestures.zoomBy(1 / 1.25, undefined, undefined, true);
          return;
        case '0':
          gestures.fitRect(bounds, 28, true);
          return;
        default:
          return;
      }
      e.preventDefault();
      gestures.requestFrame();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bounds],
  );

  const focusOnSeatIndex = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      const seat = seats[index];
      if (!seat) return;
      const targetScale = Math.max(
        gestures.viewRef.current.scale,
        SELECT_SEAT_PX / (seatPitch * 0.86),
      );
      gestures.centerOn(seat.x, seat.y, Math.min(targetScale, maxScale), true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seats, seatPitch, maxScale],
  );

  // ---------------------------------------------------------------------------
  // Selección → resumen
  // ---------------------------------------------------------------------------
  const selectedInfo: SelectedSeatInfo[] = useMemo(() => {
    return selected
      .map((id) => {
        const idx = indexById.get(id);
        if (idx == null) return null;
        const seat = seats[idx];
        return {
          seatId: id,
          label: seat.label,
          sectionName: seat.sectionName,
          sectionSlug: sectionMeta.get(seat.sectionId)?.slug ?? '',
          price: seat.price,
          offerId: seat.offerId,
        };
      })
      .filter((x): x is SelectedSeatInfo => Boolean(x));
  }, [selected, indexById, seats, sectionMeta]);

  const selectionTotalValue = selectedInfo.reduce((s, x) => s + x.price, 0);
  const focused = focusedIndex >= 0 ? seats[focusedIndex] : null;
  const focusedStatus = focusedIndex >= 0 ? statusAt(focusedIndex) : null;

  const totalTickets = feed.aggregates?.totalTickets ?? 0;
  const loadPercent =
    totalTickets > 0 ? Math.min(100, Math.round((feed.loadedTickets / totalTickets) * 100)) : 0;
  const canSelectByTap = seatPitch * viewScale * 0.86 >= SELECT_SEAT_PX;

  if (!seats.length) {
    return <p className={styles.empty}>Mapa no disponible para este evento.</p>;
  }

  return (
    <div className={styles.wrap}>
      {feed.error && (
        <p className={styles.connError} role="alert">
          {feed.error} (API: {API})
        </p>
      )}

      {feed.loadingDetail && (
        <div className={styles.loadBar}>
          <div className={styles.loadTrack} aria-hidden>
            <span style={{ width: `${loadPercent}%` }} />
          </div>
          <p role="status" aria-live="polite">
            Cargando disponibilidad… {loadPercent}%
            {totalTickets ? ` (${feed.loadedTickets.toLocaleString('es-MX')} de ${totalTickets.toLocaleString('es-MX')})` : ''}
            . Ya puedes explorar y elegir en las zonas cargadas.
          </p>
        </div>
      )}

      <div className={styles.toolbar}>
        <ul className={styles.legend} aria-label="Leyenda de estados">
          <li>
            <LegendMark kind="available" />
            Libre <em>{derived.counts.available}</em>
          </li>
          <li>
            <LegendMark kind="held" />
            Apartada <em>{derived.counts.held}</em>
          </li>
          <li>
            <LegendMark kind="sold" />
            No disponible <em>{derived.counts.sold}</em>
          </li>
          <li>
            <LegendMark kind="selected" />
            Tuya <em>{selected.length}</em>
          </li>
          <li>
            <LegendMark kind="accessible" />
            Accesible <em>{derived.counts.accessibleFree}</em>
          </li>
        </ul>
        <div className={styles.zoomBtns}>
          <span className={feed.live ? styles.liveOn : styles.liveOff} role="status">
            {feed.live ? 'En vivo' : 'Actualizando cada 12 s'}
          </span>
          <button
            type="button"
            className={accessibleOnly ? styles.toggleOn : undefined}
            onClick={() => setAccessibleOnly((v) => !v)}
            aria-pressed={accessibleOnly}
            title="Mostrar solo lugares accesibles"
          >
            ♿ Accesibles
          </button>
          <button
            type="button"
            className={heatMode === 'price' ? styles.toggleOn : undefined}
            onClick={() => setHeatMode((v) => (v === 'price' ? 'off' : 'price'))}
            aria-pressed={heatMode === 'price'}
          >
            Precio
          </button>
          <button
            type="button"
            className={heatMode === 'view' ? styles.toggleOn : undefined}
            onClick={() => setHeatMode((v) => (v === 'view' ? 'off' : 'view'))}
            aria-pressed={heatMode === 'view'}
            disabled={seats.length > SIGHTLINE_MAX_SEATS}
            title={
              seats.length > SIGHTLINE_MAX_SEATS
                ? 'El heat de vista no está disponible en recintos de más de 12.000 butacas'
                : 'Calor de calidad de vista (sightlines)'
            }
          >
            Vista
          </button>
          <button
            type="button"
            className={showEgress ? styles.toggleOn : undefined}
            onClick={() => setShowEgress((v) => !v)}
            aria-pressed={showEgress}
            aria-controls="egress-legend egress-status"
            title="Rutas de salida por sección"
            disabled={
              !projected.aisles.length && !projected.exits.length && !projected.stairs.length
            }
          >
            Salidas
          </button>
          <button type="button" onClick={() => gestures.zoomBy(1.25, undefined, undefined, true)} aria-label="Acercar">
            +
          </button>
          <button type="button" onClick={() => gestures.zoomBy(1 / 1.25, undefined, undefined, true)} aria-label="Alejar">
            −
          </button>
          <button type="button" onClick={() => gestures.fitRect(bounds, 28, true)} aria-label="Ajustar al recinto">
            Encajar
          </button>
        </div>
      </div>

      {heatMode === 'price' && priceRange.max > priceRange.min && (
        <div className={styles.heatBar}>
          <div className={styles.heatScale} aria-hidden />
          <div className={styles.heatLabels}>
            <span>${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
            <span>Heat de precio</span>
            <span>${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
          </div>
          <label className={styles.priceFilter}>
            Máx. ${((priceCap ?? priceRange.max) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            <input
              type="range"
              min={priceRange.min}
              max={priceRange.max}
              step={Math.max(1, Math.round((priceRange.max - priceRange.min) / 20))}
              value={priceCap ?? priceRange.max}
              onChange={(e) => setPriceCap(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {heatMode === 'view' && (
        <div className={styles.heatBar}>
          <div className={styles.viewHeatScale} aria-hidden />
          <div className={styles.heatLabels}>
            <span>Restringida</span>
            <span>Heat de vista</span>
            <span>Premium</span>
          </div>
        </div>
      )}

      {showEgress && (
        <ul id="egress-legend" className={styles.egressLegend} aria-label="Leyenda de salidas">
          <li>
            <span className={`${styles.swatch} ${styles.swatchExit}`} aria-hidden />
            Salida
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

      {showEgress && egressOverlay && (
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

      {levels.length > 0 && (
        <div className={styles.sections} role="toolbar" aria-label="Niveles">
          <button
            type="button"
            className={levelFilter === 'ALL' ? styles.secActive : styles.sec}
            onClick={() => {
              setLevelFilter('ALL');
              selectSection('ALL');
            }}
          >
            Todos los niveles
          </button>
          {levels.map((lv) => (
            <button
              key={lv.id}
              type="button"
              className={levelFilter === lv.id ? styles.secActive : styles.sec}
              onClick={() => {
                setLevelFilter(lv.id);
                setSectionFilter('ALL');
              }}
            >
              {lv.name}
            </button>
          ))}
        </div>
      )}

      {visibleSections.length > 0 && (
        <div className={styles.sections} role="toolbar" aria-label="Secciones">
          <button
            type="button"
            className={sectionFilter === 'ALL' ? styles.secActive : styles.sec}
            onClick={() => selectSection('ALL')}
          >
            Todo el venue
          </button>
          {visibleSections.map((sec) => {
            const price = priceOf(sec.id);
            const stat = derived.bySection.get(sec.id);
            return (
              <button
                key={sec.id}
                type="button"
                className={sectionFilter === sec.id ? styles.secActive : styles.sec}
                onClick={() => selectSection(sec.id)}
              >
                <i
                  style={{
                    background:
                      heatMode === 'price'
                        ? priceHeatColor(price, priceRange.min, priceRange.max)
                        : sec.color,
                  }}
                />
                {sec.name}
                {stat && <em>{stat.free} libres</em>}
                {price > 0 && (
                  <em>${price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</em>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={gestures.containerRef}
        className={`${styles.viewport} ${panning ? styles.dragging : ''}`}
        // El mapa es una superficie de manipulación directa: el navegador no
        // debe robar el gesto. La caja mide ≤58vh a propósito, para que quede
        // página alrededor por la que hacer scroll con el dedo.
        style={{ touchAction: 'none' }}
        tabIndex={0}
        // `application` porque las flechas aquí significan «desplazar el
        // mapa», no «leer la siguiente línea». La compra completa está
        // disponible sin este control, en el selector accesible de abajo.
        role="application"
        aria-label="Mapa gráfico del recinto. Flechas para desplazar, más y menos para acercar, 0 para ver todo. Para elegir butaca con teclado o lector de pantalla, usa «Elegir butaca por lista», más abajo."
        aria-describedby="map-help"
        onKeyDown={onMapKeyDown}
      >
        <div className={styles.stageBanner}>
          <span>Escenario</span>
        </div>

        {/* Capa estructural inferior — pocos nodos, se queda en SVG. */}
        <svg className={styles.svg} aria-hidden focusable="false" style={{ opacity: ready ? 1 : 0 }}>
          <defs>
            <linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2a1218" />
              <stop offset="100%" stopColor="#12080c" />
            </linearGradient>
          </defs>
          <g ref={svgBaseGroupRef}>
            <rect
              x={stage.x}
              y={stage.y}
              width={stage.width}
              height={20}
              rx={2}
              fill="url(#stageGrad)"
              stroke="rgba(225,29,72,0.45)"
              strokeWidth={1}
            />
            <rect
              x={stage.x + stage.width * 0.22}
              y={stage.y - 4}
              width={stage.width * 0.56}
              height={3}
              rx={1}
              fill="#e11d48"
              opacity={0.9}
            />
            {projected.aisles.map((aisle) =>
              levelFilter !== 'ALL' && aisle.levelId && aisle.levelId !== levelFilter ? null : (
                <polyline
                  key={aisle.id}
                  points={aisle.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(148,163,184,0.35)"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            )}
            {projected.obstacles.map((obs) =>
              levelFilter !== 'ALL' && obs.levelId && obs.levelId !== levelFilter ? null : (
                <polygon
                  key={obs.id}
                  points={obs.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="rgba(63,63,70,0.55)"
                  stroke="rgba(161,161,170,0.5)"
                  strokeWidth={1}
                />
              ),
            )}
            {projected.stairs.map((stair) =>
              levelFilter !== 'ALL' &&
              stair.fromLevelId &&
              stair.toLevelId &&
              stair.fromLevelId !== levelFilter &&
              stair.toLevelId !== levelFilter ? null : (
                <polyline
                  key={stair.id}
                  points={stair.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(251,146,60,0.7)"
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="8 5"
                />
              ),
            )}
            {projected.furniture.map((item) => {
              if (levelFilter !== 'ALL' && item.levelId && item.levelId !== levelFilter) return null;
              if (item.type === 'led') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`}>
                    <rect x={-26} y={-8} width={52} height={16} rx={2} fill="#1a0510" stroke="#be123c" strokeWidth={1} />
                    <rect x={-22} y={-5} width={44} height={10} rx={1} fill="#be123c" opacity={0.55} />
                  </g>
                );
              }
              if (item.type === 'speaker') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`}>
                    <rect x={-7} y={-10} width={14} height={20} rx={2} fill="#0f0f12" stroke="#404040" strokeWidth={1} />
                    <circle cx={0} cy={-4} r={3.4} fill="#27272a" />
                    <circle cx={0} cy={5} r={2.4} fill="#27272a" />
                  </g>
                );
              }
              if (item.type === 'door') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`}>
                    <rect x={-10} y={-4} width={20} height={8} rx={1} fill="rgba(34,197,94,0.35)" stroke="#22c55e" strokeWidth={1.2} />
                    <text y={-8} textAnchor="middle" fontSize={7} fill="#86efac" fontWeight={700}>
                      Puerta
                    </text>
                  </g>
                );
              }
              return null;
            })}
          </g>
        </svg>

        {/* Capa de secciones: sólo se repinta con la transformación o los filtros. */}
        <canvas ref={sectionCanvasRef} className={styles.canvas} aria-hidden />
        {/* Capa de butacas: es la única que repinta cada delta del SSE. */}
        <canvas ref={seatCanvasRef} className={styles.canvas} aria-hidden />

        {/* Overlays estructurales por encima de las butacas. */}
        <svg className={styles.svg} aria-hidden focusable="false" style={{ opacity: ready ? 1 : 0 }}>
          <g ref={svgOverlayGroupRef}>
            {projected.exits.map((ex) => {
              if (levelFilter !== 'ALL' && ex.levelId && ex.levelId !== levelFilter) return null;
              if (!ex.points.length) return null;
              const [x, y] = ex.points[0];
              const r = Math.max((ex.width ?? 32) * 0.28, 7);
              return (
                <g key={ex.id} opacity={0.95}>
                  {ex.points.length >= 2 ? (
                    <polyline
                      points={ex.points.map(([px, py]) => `${px},${py}`).join(' ')}
                      fill="none"
                      stroke="rgba(34,197,94,0.55)"
                      strokeWidth={ex.width ?? 28}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle cx={x} cy={y} r={r} fill="rgba(34,197,94,0.85)" stroke="#14532d" strokeWidth={1.5} />
                  <text x={x} y={y - r - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#bbf7d0">
                    {ex.label ?? 'Salida'}
                  </text>
                </g>
              );
            })}
            {showEgress &&
              egressOverlay?.paths.map((path) => {
                const active = path.sectionId === highlightEgressSectionId;
                return (
                  <polyline
                    key={`egress-${path.sectionId}`}
                    points={path.points.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={active ? '#f472b6' : 'rgba(244,114,182,0.35)'}
                    strokeWidth={active ? 5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={active ? '10 6' : '6 5'}
                    opacity={active ? 0.95 : 0.55}
                  />
                );
              })}
            {showEgress &&
              egressOverlay?.bottlenecks.map((b) => (
                <polyline
                  key={`bn-${b.edgeId}`}
                  points={b.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(251,146,60,0.9)"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              ))}
            {(map.venue?.focusPoints ?? []).map((f) => {
              if (levelFilter !== 'ALL' && f.levelId && f.levelId !== levelFilter) return null;
              return (
                <g key={f.id}>
                  <circle cx={f.x} cy={f.y} r={6} fill="rgba(250,250,250,0.92)" stroke="#e11d48" strokeWidth={2} />
                  <text x={f.x} y={f.y - 10} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fecdd3">
                    {f.label ?? 'Foco'}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <p className={styles.hint} id="map-help">
          {canSelectByTap
            ? 'Toca una butaca para elegirla · pellizca para el zoom · doble toque para acercar'
            : 'Toca una zona para acercarte · pellizca para el zoom · las butacas aparecen al ampliar'}
        </p>
      </div>

      {/* Detalle de la butaca bajo el cursor: informativo, NO región viva.
          Quien navega con lector de pantalla llega a la butaca por el selector
          accesible, cuya opción ya lleva el detalle completo en su nombre; una
          región viva aquí haría que todo se dijera dos veces. */}
      <p className={styles.focus}>
        {focused
          ? `${focused.row ? `Fila ${focused.row}, ` : ''}butaca ${focused.label}, ${focused.sectionName}, $${focused.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}${focused.accessible ? ', lugar accesible' : ''}${
              focusedStatus === 'available'
                ? ', disponible'
                : focusedStatus === 'held'
                  ? ', apartada'
                  : focusedStatus === 'selected'
                    ? ', seleccionada'
                    : focusedStatus === 'unknown'
                      ? ', cargando'
                      : ', no disponible'
            }`
          : 'Explora el mapa o usa el selector accesible de abajo'}
      </p>

      {/* Única región viva del mapa: el RESULTADO de la última acción
          («agregada», «la apartó otro comprador», «máximo alcanzado»). Es lo
          que el foco por sí solo no cuenta. */}
      <p className={styles.actionMessage} role="status" aria-live="polite">
        {statusMessage}
      </p>

      <aside className={styles.tray} aria-label="Selección">
        <div className={styles.trayHead}>
          <div>
            <p className={styles.trayTitle}>
              {selectedInfo.length
                ? `${selectedInfo.length} asiento${selectedInfo.length === 1 ? '' : 's'}`
                : 'Ninguno seleccionado'}
            </p>
            <p className={styles.traySub}>
              {selectedInfo.length
                ? `Total $${selectionTotalValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
                : `Máx. ${maxSelect} · elige en el mapa o en la lista`}
            </p>
          </div>
          {selectedInfo.length > 0 && onClear && (
            <button type="button" className={styles.trayClear} onClick={onClear}>
              Limpiar
            </button>
          )}
        </div>
        {selectedInfo.length > 0 && (
          <ul className={styles.trayList}>
            {selectedInfo.map((item) => (
              <li key={item.seatId}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.sectionName} · ${item.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <button type="button" aria-label={`Quitar ${item.label}`} onClick={() => onToggle(item.seatId)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <AccessibleSeatPicker
        seats={seats}
        sectionOrder={visibleSections.map((s) => ({ id: s.id, name: s.name }))}
        seatIndexesBySection={seatIndexesBySection}
        statusAt={statusAt}
        selectedIds={selected}
        maxSelect={maxSelect}
        currency={currency}
        accessibleOnly={accessibleOnly}
        onAccessibleOnlyChange={setAccessibleOnly}
        onToggleSeat={onToggle}
        onFocusSeat={focusOnSeatIndex}
        loading={feed.loadingDetail}
      />
    </div>
  );
}

/**
 * Marca de leyenda: forma + color. El estado no puede comunicarse sólo por
 * color (WCAG 1.4.1), así que la leyenda enseña exactamente la silueta que
 * dibuja el canvas.
 */
function LegendMark({ kind }: { kind: 'available' | 'held' | 'sold' | 'selected' | 'accessible' }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true } as const;
  if (kind === 'accessible') {
    return (
      <svg {...common} className={styles.legendMark}>
        <circle cx={7} cy={7} r={5} fill="#22d3ee" stroke="#fff" strokeWidth={1.2} />
      </svg>
    );
  }
  const fill =
    kind === 'available'
      ? SEAT_STATUS_COLORS.available
      : kind === 'held'
        ? SEAT_STATUS_COLORS.held
        : kind === 'sold'
          ? SEAT_STATUS_COLORS.sold
          : SEAT_STATUS_COLORS.selected;
  return (
    <svg {...common} className={styles.legendMark}>
      <rect x={1.5} y={2.5} width={11} height={9} rx={1.5} fill={fill} />
      {kind === 'held' && (
        <path d="M3.5 10.5 L10.5 3.5" stroke="rgba(9,9,11,0.8)" strokeWidth={1.6} strokeLinecap="round" />
      )}
      {kind === 'sold' && (
        <path
          d="M3.5 4 L10.5 10 M10.5 4 L3.5 10"
          stroke="rgba(250,250,250,0.7)"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      )}
      {kind === 'selected' && (
        <rect x={0.5} y={1.5} width={13} height={11} rx={2} fill="none" stroke="#fff" strokeWidth={1.2} />
      )}
    </svg>
  );
}

/** Derive checkout offerId from majority zone among selected seats */
export function primaryOfferIdFromSelection(items: SelectedSeatInfo[], fallback = ''): string {
  if (!items.length) return fallback;
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.offerId) continue;
    counts.set(i.offerId, (counts.get(i.offerId) ?? 0) + 1);
  }
  let best = fallback;
  let n = 0;
  for (const [id, c] of counts) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best || items[0]?.offerId || fallback;
}

export function selectionTotal(items: SelectedSeatInfo[]): number {
  return items.reduce((s, i) => s + i.price, 0);
}
