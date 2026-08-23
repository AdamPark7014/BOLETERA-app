'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  calculateSightlines,
  normalizeSeatMap,
  projectTo2D,
  resolveGeometry,
  sightlineHeatColor,
  priceHeatColor,
  buildEgressPathOverlays,
} from '@boletera/venue-engine';
import { loadSeatStatuses, subscribeInventory } from '@/lib/inventory';
import styles from './PosSeatMap.module.scss';

type HeatMode = 'off' | 'price' | 'view';

/** Sólo AVAILABLE se puede vender. Todo lo demás (SOLD, USED, TRANSFERRED,
 *  RESOLD, REFUNDED, EXPIRED) es lugar ocupado desde la ventanilla. */
function isSellable(status: string | undefined): boolean {
  return !status || status === 'available';
}

export type PosMapData = {
  version?: number;
  sections?: {
    id?: string;
    name?: string;
    slug?: string;
    zone?: string;
    color?: string;
    seats?: { id: string; label?: string; x: number; y: number; rotation?: number }[];
  }[];
  viewport?: { minX?: number; minY?: number; width?: number; height?: number };
};

export function PosSeatMap({
  eventId,
  mapData,
  selected,
  onToggle,
  offers = [],
}: {
  eventId: string;
  mapData: PosMapData | null;
  selected: string[];
  onToggle: (seatId: string) => void;
  offers?: { id: string; zone: string; name?: string; basePrice: string | number }[];
}) {
  const [statusBySeat, setStatusBySeat] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [heatMode, setHeatMode] = useState<HeatMode>('off');
  const [showEgress, setShowEgress] = useState(false);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const map = useMemo(() => normalizeSeatMap(mapData ?? { sections: [] }), [mapData]);
  const scene = useMemo(() => resolveGeometry(map), [map]);
  const projected = useMemo(() => projectTo2D(scene), [scene]);
  const bounds = useMemo(() => projected.bounds, [projected.bounds]);
  const seats = useMemo(() => {
    return projected.seats.map((s) => {
      const section = map.sections.find((sec) => sec.id === s.sectionId);
      const offer =
        offers.find(
          (o) =>
            o.zone.toLowerCase() === (section?.slug ?? '').toLowerCase() ||
            o.zone.toLowerCase() === (section?.name ?? '').toLowerCase(),
        ) ?? null;
      return {
        ...s,
        sectionName: section?.name ?? s.sectionId,
        sectionColor: s.color || section?.color || '#5b9fd4',
        price: offer ? Number(offer.basePrice) : undefined,
      };
    });
  }, [projected.seats, map.sections, offers]);

  const levels = useMemo(() => {
    const list = [...(map.venue?.levels ?? [])];
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }, [map.venue?.levels]);

  const visibleSeats = useMemo(() => {
    if (levelFilter === 'ALL') return seats;
    return seats.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [seats, levelFilter]);

  const priceRange = useMemo(() => {
    const prices = visibleSeats
      .map((s) => s.price)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [visibleSeats]);

  useEffect(() => {
    if (priceCap == null && priceRange.max > 0) setPriceCap(priceRange.max);
  }, [priceRange.max, priceCap]);

  const sightlineBySeat = useMemo(() => {
    if (heatMode !== 'view') return null;
    const result = calculateSightlines(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    return new Map(result.scores.map((s) => [s.seatId, s.score]));
  }, [heatMode, scene, levelFilter]);

  function toggleHeat(mode: Exclude<HeatMode, 'off'>) {
    setHeatMode((cur) => (cur === mode ? 'off' : mode));
  }

  const egressOverlay = useMemo(() => {
    if (!showEgress) return null;
    return buildEgressPathOverlays(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, scene, levelFilter]);

  const highlightEgressSectionId = useMemo(() => {
    if (!egressOverlay?.paths.length) return null;
    if (selected.length) {
      const seat = seats.find((s) => s.id === selected[0]);
      if (seat?.sectionId) return seat.sectionId;
    }
    return egressOverlay.paths[0]?.sectionId ?? null;
  }, [egressOverlay, selected, seats]);

  const counts = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const s of visibleSeats) {
      const st = statusBySeat[s.id];
      if (st === 'held') held += 1;
      else if (!isSellable(st)) sold += 1;
      else available += 1;
    }
    return { available, held, sold, total: visibleSeats.length };
  }, [visibleSeats, statusBySeat]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !seats.length) return;
    const pad = 20;
    const vw = el.clientWidth - pad * 2;
    const vh = el.clientHeight - pad * 2;
    if (vw <= 0 || vh <= 0) return;
    const next = Math.min(vw / bounds.width, vh / bounds.height, 2.4);
    setScale(next);
    setTx(el.clientWidth / 2 - (bounds.minX + bounds.width / 2) * next);
    setTy(el.clientHeight / 2 - (bounds.minY + bounds.height / 2) * next);
  }, [bounds, seats.length]);

  /**
   * Estado por butaca contra el contrato nuevo.
   *
   * `availability` ya NO trae `tickets[]` — leerlo dejaba `statusBySeat` vacío y
   * el mapa pintaba TODO como libre, así que la ventanilla ofrecía asientos ya
   * vendidos. Ahora: barrido inicial paginado por `/seats` y, a partir de ahí,
   * DELTAS por SSE. Sólo se rebarre si el productor avisa de `truncated`.
   */
  useEffect(() => {
    if (!eventId) return undefined;
    const signal = { cancelled: false };

    const sweep = () => {
      loadSeatStatuses(eventId, signal)
        .then((statuses) => {
          if (signal.cancelled) return;
          setStatusBySeat(statuses);
          setConnError(null);
        })
        .catch((err: unknown) => {
          if (!signal.cancelled) {
            setConnError(err instanceof Error ? err.message : 'Sin disponibilidad');
          }
        });
    };

    sweep();

    const unsubscribe = subscribeInventory(eventId, {
      onLive: setLive,
      onTruncated: sweep,
      onDelta: (delta) => {
        if (signal.cancelled) return;
        setStatusBySeat((prev) => {
          const next = { ...prev };
          for (const change of delta.changes) {
            if (change.seatId) next[change.seatId] = change.status.toLowerCase();
          }
          return next;
        });
      },
    });

    // Red de seguridad si el SSE no llega a establecerse (proxy, CORS, PWA):
    // un barrido cada 30 s cuesta bastante menos que vender un lugar ocupado.
    const poll = setInterval(sweep, 30000);

    return () => {
      signal.cancelled = true;
      unsubscribe();
      clearInterval(poll);
    };
  }, [eventId]);

  function seatFill(seatId: string, sectionColor: string) {
    const st = statusBySeat[seatId];
    if (selected.includes(seatId)) return '#e11d48';
    if (st === 'held') return '#d4a017';
    if (!isSellable(st)) return '#3f3f46';
    return sectionColor;
  }

  function onKeyDown(e: KeyboardEvent, seatId: string, disabled: boolean) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(seatId);
    }
  }

  if (!seats.length) {
    return <p className={styles.empty}>Sin mapa — usa venta por zona.</p>;
  }

  const focused = seats.find((s) => s.id === focusedId);

  return (
    <div className={styles.wrap}>
      {connError && (
        <p className={styles.connError} role="alert">
          {connError}
        </p>
      )}
      <div className={styles.toolbar}>
        <ul className={styles.legend}>
          <li>
            <span className={`${styles.dot} ${styles.dotAvailable}`} /> Disp. <em>{counts.available}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotHeld}`} /> Hold <em>{counts.held}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotSold}`} /> Vend. <em>{counts.sold}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotSelected}`} /> Sel. <em>{selected.length}</em>
          </li>
        </ul>
        {levels.length > 0 && (
          <div className={styles.levelBar} role="toolbar" aria-label="Niveles">
            <button
              type="button"
              className={levelFilter === 'ALL' ? styles.levelActive : styles.levelBtn}
              onClick={() => setLevelFilter('ALL')}
            >
              Todos
            </button>
            {levels.map((lv) => (
              <button
                key={lv.id}
                type="button"
                className={levelFilter === lv.id ? styles.levelActive : styles.levelBtn}
                onClick={() => setLevelFilter(lv.id)}
              >
                {lv.name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={heatMode === 'price' ? styles.levelActive : styles.levelBtn}
          onClick={() => toggleHeat('price')}
          aria-pressed={heatMode === 'price'}
          title="Colorea asientos por precio de oferta"
          disabled={!(priceRange.max > 0)}
        >
          Precio
        </button>
        <button
          type="button"
          className={heatMode === 'view' ? styles.levelActive : styles.levelBtn}
          onClick={() => toggleHeat('view')}
          aria-pressed={heatMode === 'view'}
          title="Colorea asientos por calidad de vista"
        >
          Vista
        </button>
        <button
          type="button"
          className={showEgress ? styles.levelActive : styles.levelBtn}
          onClick={() => setShowEgress((v) => !v)}
          aria-pressed={showEgress}
          aria-controls="pos-egress-legend pos-egress-status"
          title="Rutas de salida por sección"
          disabled={
            !(projected.aisles.length || projected.exits.length || projected.stairs.length)
          }
        >
          Salidas
        </button>
        <span className={live ? styles.liveOn : styles.liveOff}>{live ? 'En vivo' : 'Polling'}</span>
      </div>

      {heatMode === 'price' && priceRange.max > 0 && (
        <div className={styles.priceHeatPanel}>
          <div className={styles.viewHeatBar} aria-hidden>
            <span>
              ${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            </span>
            <div className={styles.priceHeatScale} />
            <span>
              ${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            </span>
          </div>
          {priceRange.max > priceRange.min && (
            <label className={styles.priceFilter}>
              Máx. $
              {((priceCap ?? priceRange.max) || 0).toLocaleString('es-MX', {
                maximumFractionDigits: 0,
              })}
              <input
                type="range"
                min={priceRange.min}
                max={priceRange.max}
                step={Math.max(1, Math.round((priceRange.max - priceRange.min) / 20))}
                value={priceCap ?? priceRange.max}
                onChange={(e) => setPriceCap(Number(e.target.value))}
                aria-label="Precio máximo"
              />
            </label>
          )}
        </div>
      )}
      {heatMode === 'view' && (
        <div className={styles.viewHeatBar} aria-hidden>
          <span>Restringida</span>
          <div className={styles.viewHeatScale} />
          <span>Premium</span>
        </div>
      )}
      {showEgress && (
        <ul id="pos-egress-legend" className={styles.egressLegend} aria-label="Leyenda de salidas">
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
            Activa
          </li>
          <li>
            <span className={`${styles.swatch} ${styles.swatchBottleneck}`} aria-hidden />
            Cuello
          </li>
        </ul>
      )}
      {showEgress && egressOverlay && (
        <p id="pos-egress-status" className={styles.egressHint} role="status" aria-live="polite">
          {egressOverlay.hasNetwork
            ? `Rutas · ${egressOverlay.paths.length} sec.${
                egressOverlay.clearanceMinutes != null
                  ? ` · ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                  : ''
              }`
            : 'Sin red de egreso'}
        </p>
      )}

      <div ref={viewportRef} className={styles.mapShell}>
        <p className={styles.stage}>Escenario</p>
        <svg
          className={styles.map}
          role="img"
          aria-label={showEgress ? 'Mapa POS con rutas de salida' : 'Mapa POS'}
          aria-describedby={showEgress ? 'pos-egress-legend pos-egress-status' : undefined}
        >
          <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
            {projected.stage ? (
              <rect
                x={projected.stage.x}
                y={projected.stage.y}
                width={projected.stage.width}
                height={18}
                rx={2}
                className={styles.stageRect}
              />
            ) : (
              <rect
                x={bounds.minX + (bounds.width - bounds.width * 0.42) / 2}
                y={bounds.minY - 32}
                width={bounds.width * 0.42}
                height={18}
                rx={2}
                className={styles.stageRect}
              />
            )}
            {projected.aisles.map((aisle) => {
              if (levelFilter !== 'ALL' && aisle.levelId && aisle.levelId !== levelFilter) {
                return null;
              }
              return (
              <polyline
                key={aisle.id}
                points={aisle.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="rgba(148,163,184,0.4)"
                strokeWidth={10}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              );
            })}
            {projected.obstacles.map((obs) => {
              if (levelFilter !== 'ALL' && obs.levelId && obs.levelId !== levelFilter) {
                return null;
              }
              return (
              <polygon
                key={obs.id}
                points={obs.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="rgba(63,63,70,0.5)"
                stroke="rgba(161,161,170,0.45)"
                strokeWidth={1}
              />
              );
            })}
            {projected.stairs.map((stair) => {
              if (
                levelFilter !== 'ALL' &&
                stair.fromLevelId &&
                stair.toLevelId &&
                stair.fromLevelId !== levelFilter &&
                stair.toLevelId !== levelFilter
              ) {
                return null;
              }
              return (
              <polyline
                key={stair.id}
                points={stair.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="rgba(251,146,60,0.75)"
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="8 5"
              />
              );
            })}
            {projected.exits.map((ex) => {
              if (levelFilter !== 'ALL' && ex.levelId && ex.levelId !== levelFilter) return null;
              if (!ex.points.length) return null;
              const [x, y] = ex.points[0];
              const r = Math.max((ex.width ?? 32) * 0.28, 7);
              return (
                <g key={ex.id} style={{ pointerEvents: 'none' }}>
                  {ex.points.length >= 2 ? (
                    <polyline
                      points={ex.points.map(([px, py]) => `${px},${py}`).join(' ')}
                      fill="none"
                      stroke="rgba(34,197,94,0.5)"
                      strokeWidth={ex.width ?? 28}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle cx={x} cy={y} r={r} fill="rgba(34,197,94,0.9)" stroke="#14532d" strokeWidth={1.5} />
                  <text x={x} y={y - r - 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#bbf7d0">
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
                    stroke={active ? '#f472b6' : 'rgba(244,114,182,0.4)'}
                    strokeWidth={active ? 5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={active ? '10 6' : '6 5'}
                    opacity={active ? 0.95 : 0.55}
                    style={{ pointerEvents: 'none' }}
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
                  style={{ pointerEvents: 'none' }}
                />
              ))}

            {projected.furniture.map((item) => {
              if (levelFilter !== 'ALL' && item.levelId && item.levelId !== levelFilter) {
                return null;
              }
              if (item.type === 'led') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`} style={{ pointerEvents: 'none' }}>
                    <rect x={-26} y={-8} width={52} height={16} rx={2} fill="#1a0510" stroke="var(--bl-accent-text)" strokeWidth={1} />
                    <rect x={-22} y={-5} width={44} height={10} rx={1} fill="var(--bl-accent-text)" opacity={0.55} />
                    <text y={-12} textAnchor="middle" fontSize={7} fontWeight={700} fill="#fda4af">
                      LED
                    </text>
                  </g>
                );
              }
              if (item.type === 'speaker') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`} style={{ pointerEvents: 'none' }}>
                    <rect x={-7} y={-10} width={14} height={20} rx={2} fill="#0f0f12" stroke="var(--bl-gray-700)" strokeWidth={1} />
                    <circle cx={0} cy={-4} r={3.4} fill="var(--bl-gray-800)" />
                    <circle cx={0} cy={5} r={2.4} fill="var(--bl-gray-800)" />
                  </g>
                );
              }
              if (item.type === 'door') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`} style={{ pointerEvents: 'none' }}>
                    <rect
                      x={-10}
                      y={-4}
                      width={20}
                      height={8}
                      rx={1}
                      fill="rgba(34,197,94,0.35)"
                      stroke="var(--bl-success)"
                      strokeWidth={1.2}
                    />
                    <text y={-8} textAnchor="middle" fontSize={7} fill="#86efac" fontWeight={700}>
                      Puerta
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {(map.venue?.focusPoints ?? []).map((f) => {
              if (levelFilter !== 'ALL' && f.levelId && f.levelId !== levelFilter) return null;
              return (
              <g key={f.id} style={{ pointerEvents: 'none' }}>
                <circle cx={f.x} cy={f.y} r={6} fill="rgba(250,250,250,0.92)" stroke="var(--bl-accent)" strokeWidth={2} />
                <text
                  x={f.x}
                  y={f.y - 10}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill="#fecdd3"
                >
                  {f.label ?? 'Foco'}
                </text>
              </g>
              );
            })}

            {map.sections.map((sec) => {
              if (!sec.seats.length) return null;
              if (levelFilter !== 'ALL' && (sec.levelId ?? '') !== levelFilter) return null;
              const xs = sec.seats.map((s) => s.x);
              const ys = sec.seats.map((s) => s.y);
              const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
              const ly = Math.min(...ys) - 16;
              return (
                <text
                  key={sec.id}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  className={styles.sectionLabel}
                  fill={sec.color || '#a1a1aa'}
                >
                  {sec.name}
                </text>
              );
            })}
            {seats.map((s) => {
              if (levelFilter !== 'ALL' && (s.levelId ?? '') !== levelFilter) return null;
              const st = statusBySeat[s.id];
              const blocked = Boolean(s.visibility?.blocked);
              const restricted = Boolean(s.visibility?.restrictedView);
              const price = typeof s.price === 'number' ? s.price : 0;
              const overBudget = priceCap != null && price > priceCap;
              const disabled = !isSellable(st) || st === 'held' || blocked || overBudget;
              const viewScore = sightlineBySeat?.get(s.id);
              const fill = selected.includes(s.id)
                ? '#e11d48'
                : blocked
                  ? '#3f3f46'
                  : st === 'held'
                    ? '#d4a017'
                    : !isSellable(st)
                      ? '#3f3f46'
                      : overBudget
                        ? '#2a2a2e'
                        : heatMode === 'price' && price > 0 && priceRange.max > 0
                          ? priceHeatColor(price, priceRange.min, priceRange.max)
                          : heatMode === 'view' && viewScore != null
                            ? sightlineHeatColor(viewScore)
                            : s.visibility?.premiumView
                              ? '#d4a017'
                              : seatFill(s.id, s.sectionColor);
              return (
                <g
                  key={s.id}
                  transform={`translate(${s.x} ${s.y}) rotate(${s.rotation ?? 0})`}
                  opacity={blocked || overBudget ? 0.4 : 1}
                >
                  <rect
                    x={-7}
                    y={-6}
                    width={14}
                    height={12}
                    rx={2}
                    fill={fill}
                    stroke={
                      selected.includes(s.id) ? '#fff' : restricted ? 'rgba(148,163,184,0.9)' : 'transparent'
                    }
                    strokeWidth={restricted ? 1.5 : 1.5}
                    strokeDasharray={restricted ? '2 1.5' : undefined}
                    className={disabled ? styles.seatDisabled : styles.seat}
                    tabIndex={disabled ? -1 : 0}
                    role="button"
                    aria-label={s.label}
                    aria-pressed={selected.includes(s.id)}
                    aria-disabled={disabled}
                    onFocus={() => setFocusedId(s.id)}
                    onClick={() => !disabled && onToggle(s.id)}
                    onKeyDown={(e) => onKeyDown(e, s.id, disabled)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <p className={styles.focusHint}>
        {focused
          ? `${focused.label}${focused.sectionName ? ` · ${focused.sectionName}` : ''}${focused.price != null ? ` · $${focused.price}` : ''}`
          : 'Selecciona asientos · mismo mapa que web (DB)'}
      </p>
    </div>
  );
}
