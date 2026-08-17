'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, PageHeader, Skeleton, useReducedMotion } from '@boletera/ui';
import { layoutSeatsAuto, type Venue3DHeatMode } from '@boletera/venue-3d';
import type { SeatMapData } from '@boletera/shared';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useApplyLayoutTemplate,
  useSaveVenueLayout,
  useVenueLayout,
} from '@/lib/queries/venues';
import { useEventsByVenue, usePublishEvent } from '@/lib/queries/events';
import { CameraPanel } from './panels/CameraPanel';
import { LayersPanel } from './panels/LayersPanel';
import { SeatInspectorPanel } from './panels/SeatInspectorPanel';
import { StagePanel } from './panels/StagePanel';
import { TemplatesPanel, type LayoutTemplateId } from './panels/TemplatesPanel';
import {
  applyColorMode,
  extractLevels,
  filterSeatsByLayers,
  mapToStudioSeats,
  normalizeMap,
  stageFromMap,
  withStage,
} from './seat-adapters';
import { StudioStatusBar } from './StudioStatusBar';
import { StudioToolbar } from './StudioToolbar';
import {
  CAMERA_PRESET_LABELS,
  COLOR_MODE_LABELS,
  colorModeToHeat,
  defaultLayerVisibility,
  type CameraPreset,
  type LayerVisibility,
  type StageDraft,
  type StudioColorMode,
  type StudioQuality,
  type StudioSeat,
} from './types';
import { buildMapEditorHref, buildStudioSearchParams, readStudioUrlState } from './url-state';
import { useFpsCounter } from './useFpsCounter';
import { applySightlinesToMap, useSightlineAnalysis } from './useSightlineAnalysis';
import { useStudioKeyboard } from './useStudioKeyboard';
import styles from './Venue3DStudio.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((mod) => mod.Venue3DViewer),
  {
    ssr: false,
    loading: () => <div className={styles.skeletonViewport} aria-label="Cargando visor 3D" />,
  },
);

type Venue3DStudioProps = {
  venueId: string;
};

function qualityHeight(quality: StudioQuality): number {
  if (quality === 'high') return 680;
  if (quality === 'balanced') return 560;
  return 440;
}

function viewerMode(camera: CameraPreset): 'orbit' | 'seat' {
  return camera === 'seat' ? 'seat' : 'orbit';
}

export function Venue3DStudio({ venueId }: Venue3DStudioProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const reducedMotion = useReducedMotion();

  const initialUrl = useMemo(() => readStudioUrlState(searchParams), [searchParams]);
  const studio = initialUrl.studio;

  const layoutQuery = useVenueLayout(venueId);
  const saveLayout = useSaveVenueLayout(venueId);
  const applyTemplate = useApplyLayoutTemplate(venueId);
  const eventsQuery = useEventsByVenue(venueId);

  const [draftMap, setDraftMap] = useState<SeatMapData | null>(null);
  const [stage, setStage] = useState<StageDraft>(() => stageFromMap(null));
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialUrl.seatId ? [initialUrl.seatId] : [],
  );
  const [camera, setCamera] = useState<CameraPreset>(initialUrl.camera);
  const [colorMode, setColorMode] = useState<StudioColorMode>(initialUrl.colorMode);
  const [heatMode, setHeatMode] = useState<Venue3DHeatMode>(initialUrl.heat);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>(initialUrl.levelId);
  const [quality, setQuality] = useState<StudioQuality>('balanced');
  const [layers, setLayers] = useState<LayerVisibility>(() => defaultLayerVisibility([]));
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const [viewportFading, setViewportFading] = useState(false);
  const [publishEventId, setPublishEventId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fadeTimer = useRef<number | null>(null);

  const publishEvent = usePublishEvent(publishEventId);

  const fps = useFpsCounter(Boolean(draftMap));

  // Sync server layout → draft
  useEffect(() => {
    if (!layoutQuery.data?.layout.mapData) return;
    const normalized = normalizeMap(layoutQuery.data.layout.mapData);
    if (!normalized) return;
    setDraftMap(normalized);
    setStage(stageFromMap(normalized));
    const levelIds = (normalized.venue?.levels ?? []).map((level) => level.id);
    setLayers((prev) => {
      const next = defaultLayerVisibility(levelIds);
      return {
        ...next,
        sections: prev.sections,
        furniture: prev.furniture,
        structure: prev.structure,
        aisles: prev.aisles,
        obstacles: prev.obstacles,
        exits: prev.exits,
        opacity: prev.opacity,
      };
    });
  }, [layoutQuery.data]);

  useEffect(() => {
    const events = eventsQuery.data ?? [];
    if (!publishEventId && events[0]) setPublishEventId(events[0].id);
  }, [eventsQuery.data, publishEventId]);

  const workingMap = useMemo(
    () => (draftMap ? withStage(draftMap, stage) : null),
    [draftMap, stage],
  );

  const levels = useMemo(() => extractLevels(workingMap), [workingMap]);
  const allSeats = useMemo(
    () => (workingMap ? mapToStudioSeats(workingMap) : []),
    [workingMap],
  );

  const { result: sightlineResult, bySeat: sightlineBySeat } = useSightlineAnalysis(
    workingMap,
    levelFilter,
  );

  const visibleSeats = useMemo(
    () => filterSeatsByLayers(allSeats, layers, levelFilter),
    [allSeats, layers, levelFilter],
  );

  const coloredSeats = useMemo(
    () => applyColorMode(visibleSeats, colorMode, sightlineResult),
    [visibleSeats, colorMode, sightlineResult],
  );

  const layout = useMemo(
    () =>
      layoutSeatsAuto(coloredSeats, {
        mode: 'published',
        stage: workingMap?.venue?.stage,
        aisles: layers.aisles ? workingMap?.venue?.aisles : [],
        obstacles: layers.obstacles ? workingMap?.venue?.obstacles : [],
        stairs: layers.structure ? workingMap?.venue?.stairs : [],
        exits: layers.exits && layers.structure ? workingMap?.venue?.exits : [],
        furniture: layers.furniture ? workingMap?.venue?.furniture : [],
        focusPoints: workingMap?.venue?.focusPoints,
      }),
    [coloredSeats, workingMap, layers],
  );

  const selectedSeat = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return null;
    return visibleSeats.find((seat) => seat.id === id) ?? null;
  }, [selectedIds, visibleSeats]);

  const selectedWorld = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return undefined;
    const laid = layout.seats.find((seat) => seat.id === id && !seat.decorative);
    if (!laid) return undefined;
    return { x: laid.px, y: laid.py, z: laid.pz };
  }, [layout.seats, selectedIds]);

  const stageLookAt = useMemo(() => {
    const pose = layout.stagePose;
    if (!pose) return { x: 0, y: 1.2, z: layout.stageZ };
    return { x: pose.x, y: pose.y + 1.2, z: pose.z };
  }, [layout.stagePose, layout.stageZ]);

  const cameraTarget = useMemo(() => {
    if (camera === 'seat' && selectedWorld) return selectedWorld;
    if (camera === 'stage') return stageLookAt;
    if ((camera === 'plan' || camera === 'side') && selectedWorld) return selectedWorld;
    return selectedWorld;
  }, [camera, selectedWorld, stageLookAt]);

  const effectiveViewerMode = viewerMode(camera === 'stage' && !selectedWorld ? 'orbit' : camera);

  // URL continuity (compara estado semantico, no el orden de query)
  useEffect(() => {
    const current = readStudioUrlState(searchParams);
    const same =
      current.studio === studio &&
      current.seatId === (selectedIds[0] ?? null) &&
      current.colorMode === colorMode &&
      current.levelId === levelFilter &&
      current.camera === camera &&
      current.heat === heatMode;
    if (same) return;
    const qs = buildStudioSearchParams({
      studio,
      seatId: selectedIds[0] ?? null,
      colorMode,
      levelId: levelFilter,
      camera,
      heat: heatMode,
    });
    router.replace(`${pathname}${qs}`, { scroll: false });
  }, [
    studio,
    selectedIds,
    colorMode,
    levelFilter,
    camera,
    heatMode,
    pathname,
    router,
    searchParams,
  ]);

  const transitionCamera = useCallback(
    (preset: CameraPreset) => {
      if (preset === 'seat' && selectedIds.length === 0 && visibleSeats[0]) {
        setSelectedIds([visibleSeats[0].id]);
      }
      if (reducedMotion) {
        setCamera(preset);
        setViewerEpoch((n) => n + 1);
        return;
      }
      setViewportFading(true);
      if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => {
        setCamera(preset);
        setViewerEpoch((n) => n + 1);
        setViewportFading(false);
      }, 160);
    },
    [reducedMotion, selectedIds.length, visibleSeats],
  );

  const fitVenue = useCallback(() => {
    transitionCamera('orbit');
    setViewerEpoch((n) => n + 1);
  }, [transitionCamera]);

  const onColorModeChange = useCallback((mode: StudioColorMode) => {
    setColorMode(mode);
    setHeatMode(colorModeToHeat(mode));
  }, []);

  const toggleSeat = useCallback((seatId: string) => {
    setSelectedIds((prev) => (prev[0] === seatId ? [] : [seatId]));
  }, []);

  const selectNextSeat = useCallback(
    (direction: 1 | -1) => {
      if (!visibleSeats.length) return;
      const current = selectedIds[0];
      const index = current ? visibleSeats.findIndex((seat) => seat.id === current) : -1;
      const nextIndex =
        index < 0
          ? 0
          : (index + direction + visibleSeats.length) % visibleSeats.length;
      setSelectedIds([visibleSeats[nextIndex].id]);
      if (camera === 'seat') setViewerEpoch((n) => n + 1);
    },
    [visibleSeats, selectedIds, camera],
  );

  useStudioKeyboard({
    enabled: Boolean(workingMap) && allSeats.length > 0,
    onCameraPreset: transitionCamera,
    onColorMode: onColorModeChange,
    onFit: fitVenue,
    onToggleSeatView: () =>
      transitionCamera(camera === 'seat' ? 'orbit' : 'seat'),
    onSelectNextSeat: selectNextSeat,
    onClearSelection: () => setSelectedIds([]),
  });

  useEffect(() => {
    return () => {
      if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current);
      // Remount epoch bump on unmount is handled by React tearing down Canvas.
      setDraftMap(null);
    };
  }, []);

  async function handleSave() {
    if (!workingMap) return;
    try {
      const withSight = applySightlinesToMap(workingMap);
      await saveLayout.mutateAsync(withSight);
      setDraftMap(withSight);
      setMessage('Mapa guardado. Snapshots de eventos del venue actualizados.');
      toast.success('Mapa guardado. La planta 2D y los eventos quedan sincronizados.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo guardar el mapa';
      setMessage(text);
      toast.error(text);
    }
  }

  async function handleTemplate(template: LayoutTemplateId) {
    try {
      const result = await applyTemplate.mutateAsync({ template });
      const normalized = normalizeMap(result.layout.mapData);
      if (normalized) {
        setDraftMap(normalized);
        setStage(stageFromMap(normalized));
        setSelectedIds([]);
        setViewerEpoch((n) => n + 1);
      }
      setMessage(`Plantilla ${template} aplicada.`);
      toast.success(`Plantilla ${template} aplicada. La planta 2D comparte la geometría.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Error al aplicar plantilla';
      setMessage(text);
      toast.error(text);
    }
  }

  async function handlePublish() {
    if (!publishEventId) return;
    try {
      if (workingMap) await saveLayout.mutateAsync(workingMap);
      const result = await publishEvent.mutateAsync();
      setMessage(
        `Publicado en evento: ${result.totalSeats} boletos · ${result.sections} zonas`,
      );
      toast.success(
        `Publicado: ${result.totalSeats} boletos · ${result.sections} zonas`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Error al publicar';
      setMessage(text);
      toast.error(text);
    }
  }

  const venueName = layoutQuery.data?.venue.name ?? 'Recinto';
  const mapHref = buildMapEditorHref(venueId, {
    seatId: selectedIds[0] ?? null,
    colorMode,
    levelId: levelFilter,
  });

  const overlayStyle = {
    opacity: layers.opacity.seats,
  } as CSSProperties;

  if (layoutQuery.isPending) {
    return (
      <div className={styles.studio}>
        <PageHeader
          eyebrow="Recintos"
          title={studio ? 'Estudio 3D' : 'Preview 3D'}
          description="Cargando geometría del venue…"
        />
        <Skeleton height={28} width="40%" />
        <div className={styles.skeletonViewport} role="status" aria-live="polite">
          <span className={styles.srOnly}>Cargando estudio 3D</span>
        </div>
      </div>
    );
  }

  if (layoutQuery.error) {
    return (
      <div className={styles.studio}>
        <PageHeader
          eyebrow="Recintos"
          title={studio ? 'Estudio 3D' : 'Preview 3D'}
          description="No se pudo cargar el layout del venue."
        />
        <QueryError error={layoutQuery.error} onRetry={() => void layoutQuery.refetch()} />
      </div>
    );
  }

  if (!workingMap || allSeats.length === 0) {
    return (
      <div className={styles.studio}>
        <PageHeader
          eyebrow="Recintos"
          title={`${studio ? 'Estudio 3D' : 'Preview 3D'} — ${venueName}`}
          description="Este recinto aún no tiene asientos en el mapa."
          actions={
            <a href={mapHref} className={styles.chipBtn}>
              Abrir vista planta
            </a>
          }
        />
        {studio && (
          <TemplatesPanel
            busy={applyTemplate.isPending ? String(applyTemplate.variables?.template ?? 'template') : null}
            events={(eventsQuery.data ?? []).map((event) => ({
              id: event.id,
              title: event.title,
            }))}
            publishEventId={publishEventId}
            onPublishEventIdChange={setPublishEventId}
            onApplyTemplate={handleTemplate}
            onPublish={() => void handlePublish()}
            publishing={publishEvent.isPending || saveLayout.isPending}
          />
        )}
        <EmptyState
          title="Mapa vacío"
          illustration="seats"
          description="Elige una plantilla para armar el bowl 3D (y la planta) desde cero, o abre el diseñador 2D para ajustes finos."
          action={
            studio ? (
              <div className={styles.row}>
                {(['arena', 'theater', 'stadium', 'festival'] as LayoutTemplateId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={styles.chipBtnActive}
                    disabled={applyTemplate.isPending}
                    onClick={() => void handleTemplate(id)}
                  >
                    Empezar con {id}
                  </button>
                ))}
              </div>
            ) : undefined
          }
          secondaryAction={
            <a href={mapHref} className={styles.chipBtn}>
              Ir al editor de planta
            </a>
          }
        />
      </div>
    );
  }

  const selectedSightline = selectedSeat ? sightlineBySeat.get(selectedSeat.id) ?? null : null;

  return (
    <div className={styles.studio}>
      <PageHeader
        eyebrow="Recintos"
        title={`${studio ? 'Estudio 3D' : 'Preview 3D'} — ${venueName}`}
        description={`${allSeats.length.toLocaleString('es-MX')} asientos · la planta 2D comparte esta geometría · simula qué verá el comprador desde cada asiento`}
        breadcrumbs={[
          { label: 'Recintos', href: '/venues' },
          { label: venueName, href: `/venues/${venueId}/map` },
          { label: studio ? 'Estudio 3D' : 'Preview 3D' },
        ]}
        actions={
          <div className={styles.toolbarActions}>
            <a href="/maps" className={styles.chipBtn}>
              ← Creador
            </a>
            <a href={mapHref} className={styles.chipBtn}>
              Vista planta
            </a>
          </div>
        }
      />

      <StudioToolbar
        studio={studio}
        camera={camera}
        colorMode={colorMode}
        quality={quality}
        canSave={Boolean(workingMap)}
        saving={saveLayout.isPending}
        onCameraChange={transitionCamera}
        onColorModeChange={onColorModeChange}
        onQualityChange={setQuality}
        onFit={fitVenue}
        onSave={() => void handleSave()}
        mapHref={mapHref}
      />

      {message && (
        <p className={styles.msg} role="status" aria-live="polite">
          {message}
        </p>
      )}

      <div className={styles.workspace}>
        <div className={styles.viewportColumn}>
          <div
            className={[
              styles.viewport,
              reducedMotion ? styles.viewportReduced : '',
              viewportFading ? styles.viewportFading : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={overlayStyle}
            role="application"
            aria-label="Visor 3D del recinto"
          >
            <Venue3DViewer
              key={`viewer-${viewerEpoch}-${camera}-${quality}`}
              mode={effectiveViewerMode === 'seat' && cameraTarget ? 'seat' : 'orbit'}
              selectedSeat={cameraTarget}
              seats={coloredSeats}
              selectedIds={selectedIds}
              onToggleSeat={toggleSeat}
              height={qualityHeight(quality)}
              heatMode={heatMode}
              onHeatModeChange={setHeatMode}
              stage={workingMap.venue?.stage}
              aisles={layers.aisles ? workingMap.venue?.aisles : []}
              obstacles={layers.obstacles ? workingMap.venue?.obstacles : []}
              stairs={layers.structure ? workingMap.venue?.stairs : []}
              exits={layers.exits && layers.structure ? workingMap.venue?.exits : []}
              furniture={
                layers.furniture && layers.opacity.furniture > 0
                  ? workingMap.venue?.furniture
                  : []
              }
              focusPoints={workingMap.venue?.focusPoints}
              levels={levels}
              mapData={workingMap}
            />
            <div className={styles.viewportChrome} aria-hidden>
              <div className={styles.viewportBadge}>
                <span>{CAMERA_PRESET_LABELS[camera]}</span>
                <span className={styles.fps}>{fps > 0 ? `${fps} FPS` : '…'}</span>
              </div>
            </div>
          </div>

          <StudioStatusBar
            seatCount={visibleSeats.length}
            selectedLabel={selectedSeat?.label ?? selectedSeat?.id ?? null}
            cameraLabel={CAMERA_PRESET_LABELS[camera]}
            colorLabel={COLOR_MODE_LABELS[colorMode]}
            fps={fps}
            qualityLabel={
              quality === 'high' ? 'Alta' : quality === 'balanced' ? 'Equilibrada' : 'Ligera'
            }
          />

          <div className={styles.srOnly} aria-live="polite">
            {selectedSeat
              ? `Asiento ${selectedSeat.label || selectedSeat.id}, zona ${selectedSeat.section || 'sin zona'}${
                  selectedSightline
                    ? `, visión ${COLOR_MODE_LABELS.sightline}: ${selectedSightline.grade}, ${Math.round(selectedSightline.score * 100)} por ciento`
                    : ''
                }`
              : 'Ningún asiento seleccionado'}
          </div>
        </div>

        <aside className={styles.sidePanels} aria-label="Paneles del estudio">
          <CameraPanel
            camera={camera}
            reducedMotion={reducedMotion}
            onChange={transitionCamera}
            onFit={fitVenue}
          />
          <SeatInspectorPanel
            seat={selectedSeat}
            sightline={selectedSightline}
            summary={sightlineResult?.summary ?? null}
          />
          <StagePanel
            stage={stage}
            disabled={!studio}
            onChange={(next) => {
              setStage(next);
              setViewerEpoch((n) => n + 1);
            }}
            onReset={() => setStage(stageFromMap(draftMap))}
          />
          <LayersPanel
            levels={levels}
            levelFilter={levelFilter}
            layers={layers}
            onLevelFilterChange={setLevelFilter}
            onLayersChange={setLayers}
          />
          {studio && (
            <TemplatesPanel
              busy={
                applyTemplate.isPending
                  ? String(applyTemplate.variables?.template ?? 'template')
                  : null
              }
              events={(eventsQuery.data ?? []).map((event) => ({
                id: event.id,
                title: event.title,
              }))}
              publishEventId={publishEventId}
              onPublishEventIdChange={setPublishEventId}
              onApplyTemplate={handleTemplate}
              onPublish={() => void handlePublish()}
              publishing={publishEvent.isPending || saveLayout.isPending}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

export type { StudioSeat };
