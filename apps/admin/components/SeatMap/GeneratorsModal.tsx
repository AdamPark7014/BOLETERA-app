'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SeatMapBlock, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import type { LayoutTemplateId } from '@boletera/venue-engine';
import {
  DEFAULT_NUMBERING,
  previewCurvedRow,
  previewGaZone,
  previewRenumber,
  previewSectionBlock,
  previewStraightRow,
  previewTables,
  previewTemplate,
  type BlockParams,
  type CurvedGeneratorParams,
  type GaGeneratorParams,
  type GeneratorPreviewResult,
  type GeneratorTab,
  type RenumberParams,
  type RowGeneratorParams,
  type SectionGeneratorParams,
  type TablesGeneratorParams,
  type TemplateGeneratorParams,
} from './generator-ops';
import styles from './GeneratorsModal.module.scss';

const TABS: Array<{ id: GeneratorTab; label: string; hint: string }> = [
  { id: 'section', label: 'Sección', hint: 'N filas × M butacas' },
  { id: 'row', label: 'Fila recta', hint: 'Una fila numerada' },
  { id: 'curved', label: 'Fila curva', hint: 'Teatro / auditorio' },
  { id: 'tables', label: 'Mesas', hint: 'Banquetes circulares' },
  { id: 'ga', label: 'Zona GA', hint: 'Sin asientos numerados' },
  { id: 'template', label: 'Plantilla', hint: 'Arena, teatro, estadio…' },
  { id: 'renumber', label: 'Renumerar', hint: 'Selección actual' },
];

const TEMPLATES: Array<{ id: LayoutTemplateId; label: string }> = [
  { id: 'theater', label: 'Teatro / auditorio' },
  { id: 'arena', label: 'Arena' },
  { id: 'stadium', label: 'Estadio' },
  { id: 'festival', label: 'Festival (GA + gradas)' },
];

export type GeneratorApplyPayload =
  | {
      kind: 'seats';
      seats: SeatMapSeat[];
      block?: SeatMapBlock;
      sectionParams?: Partial<SeatMapSection>;
      label: string;
    }
  | { kind: 'new-section'; section: SeatMapSection; label: string }
  | { kind: 'ga-section'; section: SeatMapSection; label: string }
  | { kind: 'template'; map: SeatMapData; label: string }
  | {
      kind: 'renumber';
      updates: Array<{ id: string; label: string; row: string }>;
      label: string;
    };

export type GeneratorsModalProps = {
  open: boolean;
  onClose: () => void;
  map: SeatMapData;
  activeSection?: SeatMapSection;
  blockParams: BlockParams;
  selected: ReadonlySet<string>;
  onPreviewChange: (seats: SeatMapSeat[] | null, gaShape?: SeatMapSection | null) => void;
  onApply: (payload: GeneratorApplyPayload) => void;
};

function numInput(
  value: number,
  onChange: (n: number) => void,
  opts: { min?: number; step?: number; max?: number } = {},
) {
  return (
    <input
      className={styles.input}
      type="number"
      value={value}
      min={opts.min}
      max={opts.max}
      step={opts.step ?? 1}
      onChange={(e) => onChange(Number(e.target.value) || opts.min || 0)}
    />
  );
}

export function GeneratorsModal({
  open,
  onClose,
  map,
  activeSection,
  blockParams,
  selected,
  onPreviewChange,
  onApply,
}: GeneratorsModalProps) {
  const [tab, setTab] = useState<GeneratorTab>('section');
  const [preview, setPreview] = useState<GeneratorPreviewResult | null>(null);
  const [mapPreview, setMapPreview] = useState(false);

  const [sectionParams, setSectionParams] = useState<SectionGeneratorParams>(() => ({
    rows: blockParams.rows,
    cols: blockParams.cols,
    seatPitch: blockParams.seatPitch,
    rowPitch: blockParams.rowPitch,
    rake: blockParams.rake,
    curvature: blockParams.curvature,
    skipColumns: blockParams.skipColumns,
    tier: 'standard',
    startRowLabel: 'A',
    yaw: 0,
    numbering: DEFAULT_NUMBERING,
    createNewSection: false,
    sectionName: 'Nueva sección',
  }));

  const [rowParams, setRowParams] = useState<RowGeneratorParams>({
    count: blockParams.cols,
    seatPitch: blockParams.seatPitch,
    yaw: 0,
    rake: blockParams.rake,
    rowLabel: 'A',
    startNumber: 1,
    tier: 'standard',
    numbering: DEFAULT_NUMBERING,
  });

  const [curvedParams, setCurvedParams] = useState<CurvedGeneratorParams>({
    count: 14,
    radius: 200,
    spanDeg: 46,
    seatPitch: blockParams.seatPitch,
    rake: blockParams.rake,
    rowLabel: 'A',
    tier: 'standard',
    yScale: 1,
    numbering: DEFAULT_NUMBERING,
  });

  const [tablesParams, setTablesParams] = useState<TablesGeneratorParams>({
    tableCount: 12,
    tablesPerRow: 4,
    seatsPerTable: 8,
    tablePitch: 120,
    seatPitch: blockParams.seatPitch,
    tier: 'standard',
  });

  const [gaParams, setGaParams] = useState<GaGeneratorParams>({
    name: 'Pista GA',
    width: 280,
    height: 180,
    capacity: 500,
  });

  const [templateParams, setTemplateParams] = useState<TemplateGeneratorParams>({
    template: 'theater',
    capacity: 400,
  });

  const [renumberParams, setRenumberParams] = useState<RenumberParams>({
    startNumber: 1,
    direction: 'ltr',
    relabelRows: true,
    rowPrefix: '',
  });

  const ctx = useMemo(
    () => ({ map, activeSection, blockParams }),
    [map, activeSection, blockParams],
  );

  const computePreview = useCallback((): GeneratorPreviewResult => {
    switch (tab) {
      case 'section':
        return previewSectionBlock(ctx, sectionParams);
      case 'row':
        return previewStraightRow(ctx, rowParams);
      case 'curved':
        return previewCurvedRow(ctx, curvedParams);
      case 'tables':
        return previewTables(ctx, tablesParams);
      case 'ga':
        return previewGaZone(ctx, gaParams);
      case 'template':
        return previewTemplate(templateParams);
      case 'renumber':
        return previewRenumber(map, selected, renumberParams);
      default:
        return previewSectionBlock(ctx, sectionParams);
    }
  }, [
    tab,
    ctx,
    sectionParams,
    rowParams,
    curvedParams,
    tablesParams,
    gaParams,
    templateParams,
    renumberParams,
    map,
    selected,
  ]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setMapPreview(false);
      onPreviewChange(null, null);
      return;
    }
    const next = computePreview();
    setPreview(next);
  }, [open, computePreview, onPreviewChange]);

  useEffect(() => {
    if (!open || !mapPreview || !preview) {
      onPreviewChange(null, null);
      return;
    }
    if (tab === 'ga' && preview.gaSection) {
      onPreviewChange(null, preview.gaSection);
      return;
    }
    if (tab === 'template' && preview.templateMap) {
      onPreviewChange(preview.templateMap.sections.flatMap((s) => s.seats), null);
      return;
    }
    onPreviewChange(preview.seats.length ? preview.seats : null, null);
  }, [open, mapPreview, preview, tab, onPreviewChange]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canApply =
    tab === 'renumber'
      ? Boolean(preview?.renumberUpdates?.length)
      : tab === 'ga'
        ? Boolean(preview?.gaSection)
        : tab === 'template'
          ? Boolean(preview?.templateMap)
          : Boolean(preview?.seats.length);

  const needsActiveSection =
    tab !== 'template' && tab !== 'ga' && tab !== 'renumber' && !sectionParams.createNewSection;

  function handleApply() {
    if (!preview) return;
    const ts = Date.now();

    if (tab === 'renumber' && preview.renumberUpdates?.length) {
      onApply({
        kind: 'renumber',
        updates: preview.renumberUpdates,
        label: `Renumerar ${preview.renumberUpdates.length} butacas`,
      });
      onClose();
      return;
    }

    if (tab === 'template' && preview.templateMap) {
      onApply({
        kind: 'template',
        map: preview.templateMap,
        label: `Plantilla ${templateParams.template}`,
      });
      onClose();
      return;
    }

    if (tab === 'ga' && preview.gaSection) {
      const section: SeatMapSection = {
        ...preview.gaSection,
        id: `sec-ga-${ts}`,
        slug: `ga-${ts}`,
      };
      onApply({ kind: 'ga-section', section, label: `Zona GA ${section.name}` });
      onClose();
      return;
    }

    const seats = preview.seats.map((s, i) => ({ ...s, id: `seat-${ts}-${i}` }));

    if (sectionParams.createNewSection && tab === 'section') {
      const section: SeatMapSection = {
        id: `sec-${ts}`,
        name: sectionParams.sectionName,
        slug: `sec-${ts}`,
        color: '#e11d48',
        seatPitch: sectionParams.seatPitch,
        rowPitch: sectionParams.rowPitch,
        rake: sectionParams.rake,
        curvature: sectionParams.curvature,
        blocks: preview.block ? [{ ...preview.block, id: `block-${ts}` }] : undefined,
        seats,
      };
      onApply({
        kind: 'new-section',
        section,
        label: `Sección ${sectionParams.rows}×${sectionParams.cols}`,
      });
      onClose();
      return;
    }

    onApply({
      kind: 'seats',
      seats,
      block: preview.block ? { ...preview.block, id: `block-${ts}` } : undefined,
      sectionParams: {
        seatPitch:
          tab === 'section'
            ? sectionParams.seatPitch
            : tab === 'row'
              ? rowParams.seatPitch
              : tab === 'curved'
                ? curvedParams.seatPitch
                : tablesParams.seatPitch,
        rowPitch: tab === 'section' ? sectionParams.rowPitch : blockParams.rowPitch,
        rake:
          tab === 'section'
            ? sectionParams.rake
            : tab === 'row'
              ? rowParams.rake
              : tab === 'curved'
                ? curvedParams.rake
                : blockParams.rake,
        curvature: tab === 'section' ? sectionParams.curvature : undefined,
      },
      label:
        tab === 'section'
          ? `Bloque ${sectionParams.rows}×${sectionParams.cols}`
          : tab === 'row'
            ? `Fila ${rowParams.rowLabel}`
            : tab === 'curved'
              ? `Fila curva ${curvedParams.rowLabel}`
              : `${tablesParams.tableCount} mesas`,
    });
    onClose();
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Generadores de layout">
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h2>Generadores</h2>
            <p>
              Crea secciones, filas y zonas con el motor paramétrico. Previsualiza antes de aplicar.
            </p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <nav className={styles.tabs} aria-label="Tipo de generador">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? styles.tabActive : styles.tab}
              onClick={() => {
                setTab(t.id);
                setMapPreview(false);
              }}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className={styles.body}>
          <div className={styles.form}>
            {tab === 'section' && (
              <>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Filas</span>
                    {numInput(sectionParams.rows, (n) => setSectionParams((p) => ({ ...p, rows: Math.max(1, n) })), {
                      min: 1,
                      max: 120,
                    })}
                  </label>
                  <label className={styles.field}>
                    <span>Butacas / fila</span>
                    {numInput(sectionParams.cols, (n) => setSectionParams((p) => ({ ...p, cols: Math.max(1, n) })), {
                      min: 1,
                      max: 120,
                    })}
                  </label>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Seat pitch</span>
                    {numInput(
                      sectionParams.seatPitch,
                      (n) => setSectionParams((p) => ({ ...p, seatPitch: Math.max(8, n) })),
                      { min: 8 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Row pitch</span>
                    {numInput(
                      sectionParams.rowPitch,
                      (n) => setSectionParams((p) => ({ ...p, rowPitch: Math.max(8, n) })),
                      { min: 8 },
                    )}
                  </label>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Rake (Z)</span>
                    {numInput(sectionParams.rake, (n) => setSectionParams((p) => ({ ...p, rake: n })), {
                      min: 0,
                    })}
                  </label>
                  <label className={styles.field}>
                    <span>Curvatura</span>
                    {numInput(
                      sectionParams.curvature,
                      (n) => setSectionParams((p) => ({ ...p, curvature: Math.max(0, n) })),
                      { min: 0,
                        step: 0.5 },
                    )}
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Pasillo (cols vacías)</span>
                  <input
                    className={styles.input}
                    value={sectionParams.skipColumns}
                    placeholder="6,7 o every:8"
                    onChange={(e) => setSectionParams((p) => ({ ...p, skipColumns: e.target.value }))}
                  />
                </label>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Fila inicial</span>
                    <input
                      className={styles.input}
                      value={sectionParams.startRowLabel}
                      maxLength={3}
                      onChange={(e) => setSectionParams((p) => ({ ...p, startRowLabel: e.target.value }))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Tier</span>
                    <input
                      className={styles.input}
                      value={sectionParams.tier}
                      onChange={(e) => setSectionParams((p) => ({ ...p, tier: e.target.value }))}
                    />
                  </label>
                </div>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={sectionParams.createNewSection}
                    onChange={(e) =>
                      setSectionParams((p) => ({ ...p, createNewSection: e.target.checked }))
                    }
                  />
                  Crear nueva sección (en vez de añadir a la activa)
                </label>
                {sectionParams.createNewSection && (
                  <label className={styles.field}>
                    <span>Nombre de sección</span>
                    <input
                      className={styles.input}
                      value={sectionParams.sectionName}
                      onChange={(e) => setSectionParams((p) => ({ ...p, sectionName: e.target.value }))}
                    />
                  </label>
                )}
              </>
            )}

            {tab === 'row' && (
              <>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Butacas</span>
                    {numInput(rowParams.count, (n) => setRowParams((p) => ({ ...p, count: Math.max(1, n) })), {
                      min: 1,
                    })}
                  </label>
                  <label className={styles.field}>
                    <span>Seat pitch</span>
                    {numInput(
                      rowParams.seatPitch,
                      (n) => setRowParams((p) => ({ ...p, seatPitch: Math.max(8, n) })),
                      { min: 8 },
                    )}
                  </label>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Etiqueta fila</span>
                    <input
                      className={styles.input}
                      value={rowParams.rowLabel}
                      onChange={(e) => setRowParams((p) => ({ ...p, rowLabel: e.target.value }))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Nº inicial</span>
                    {numInput(
                      rowParams.startNumber,
                      (n) => setRowParams((p) => ({ ...p, startNumber: Math.max(1, n) })),
                      { min: 1 },
                    )}
                  </label>
                </div>
              </>
            )}

            {tab === 'curved' && (
              <>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Butacas</span>
                    {numInput(
                      curvedParams.count,
                      (n) => setCurvedParams((p) => ({ ...p, count: Math.max(1, n) })),
                      { min: 1 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Radio</span>
                    {numInput(
                      curvedParams.radius,
                      (n) => setCurvedParams((p) => ({ ...p, radius: Math.max(40, n) })),
                      { min: 40 },
                    )}
                  </label>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Arco (°)</span>
                    {numInput(
                      curvedParams.spanDeg,
                      (n) => setCurvedParams((p) => ({ ...p, spanDeg: Math.max(10, Math.min(180, n)) })),
                      { min: 10,
                        max: 180 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Seat pitch</span>
                    {numInput(
                      curvedParams.seatPitch,
                      (n) => setCurvedParams((p) => ({ ...p, seatPitch: Math.max(8, n) })),
                      { min: 8 },
                    )}
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Etiqueta fila</span>
                  <input
                    className={styles.input}
                    value={curvedParams.rowLabel}
                    onChange={(e) => setCurvedParams((p) => ({ ...p, rowLabel: e.target.value }))}
                  />
                </label>
              </>
            )}

            {tab === 'tables' && (
              <>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Mesas</span>
                    {numInput(
                      tablesParams.tableCount,
                      (n) => setTablesParams((p) => ({ ...p, tableCount: Math.max(1, n) })),
                      { min: 1 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Mesas / fila</span>
                    {numInput(
                      tablesParams.tablesPerRow,
                      (n) => setTablesParams((p) => ({ ...p, tablesPerRow: Math.max(1, n) })),
                      { min: 1 },
                    )}
                  </label>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Butacas / mesa</span>
                    {numInput(
                      tablesParams.seatsPerTable,
                      (n) => setTablesParams((p) => ({ ...p, seatsPerTable: Math.max(2, n) })),
                      { min: 2,
                        max: 24 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Separación mesas</span>
                    {numInput(
                      tablesParams.tablePitch,
                      (n) => setTablesParams((p) => ({ ...p, tablePitch: Math.max(60, n) })),
                      { min: 60 },
                    )}
                  </label>
                </div>
              </>
            )}

            {tab === 'ga' && (
              <>
                <label className={styles.field}>
                  <span>Nombre</span>
                  <input
                    className={styles.input}
                    value={gaParams.name}
                    onChange={(e) => setGaParams((p) => ({ ...p, name: e.target.value }))}
                  />
                </label>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Ancho</span>
                    {numInput(gaParams.width, (n) => setGaParams((p) => ({ ...p, width: Math.max(40, n) })), {
                      min: 40,
                    })}
                  </label>
                  <label className={styles.field}>
                    <span>Profundidad</span>
                    {numInput(gaParams.height, (n) => setGaParams((p) => ({ ...p, height: Math.max(40, n) })), {
                      min: 40,
                    })}
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Aforo GA</span>
                  {numInput(
                    gaParams.capacity,
                    (n) => setGaParams((p) => ({ ...p, capacity: Math.max(1, n) })),
                    { min: 1,
                      step: 50 },
                  )}
                </label>
              </>
            )}

            {tab === 'template' && (
              <>
                <label className={styles.field}>
                  <span>Plantilla</span>
                  <select
                    className={styles.select}
                    value={templateParams.template}
                    onChange={(e) =>
                      setTemplateParams((p) => ({
                        ...p,
                        template: e.target.value as LayoutTemplateId,
                      }))
                    }
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Capacidad objetivo</span>
                  {numInput(
                    templateParams.capacity,
                    (n) => setTemplateParams((p) => ({ ...p, capacity: Math.max(40, n) })),
                    { min: 40,
                      step: 100 },
                  )}
                </label>
                <p className={styles.hint}>
                  Reemplaza el mapa completo con una plantilla del motor (`generateLayoutTemplate`).
                </p>
              </>
            )}

            {tab === 'renumber' && (
              <>
                <p className={styles.hint}>
                  {selected.size
                    ? `${selected.size.toLocaleString('es-MX')} butacas seleccionadas.`
                    : 'Selecciona butacas en el mapa antes de renumerar.'}
                </p>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Nº inicial</span>
                    {numInput(
                      renumberParams.startNumber,
                      (n) => setRenumberParams((p) => ({ ...p, startNumber: Math.max(1, n) })),
                      { min: 1 },
                    )}
                  </label>
                  <label className={styles.field}>
                    <span>Dirección</span>
                    <select
                      className={styles.select}
                      value={renumberParams.direction}
                      onChange={(e) =>
                        setRenumberParams((p) => ({
                          ...p,
                          direction: e.target.value as 'ltr' | 'rtl',
                        }))
                      }
                    >
                      <option value="ltr">Izq → der</option>
                      <option value="rtl">Der → izq</option>
                    </select>
                  </label>
                </div>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={renumberParams.relabelRows}
                    onChange={(e) =>
                      setRenumberParams((p) => ({ ...p, relabelRows: e.target.checked }))
                    }
                  />
                  Relabelar filas (A, B, C…)
                </label>
              </>
            )}

            {needsActiveSection && !activeSection && (
              <p className={styles.warn}>
                No hay sección activa. Crea una sección o marca «Crear nueva sección».
              </p>
            )}
          </div>

          <aside className={styles.previewPanel}>
            <h3>Vista previa</h3>
            {preview ? (
              <>
                <p className={styles.previewSummary}>{preview.stats.summary}</p>
                <dl className={styles.stats}>
                  <div>
                    <dt>Asientos</dt>
                    <dd>{preview.stats.seatCount.toLocaleString('es-MX')}</dd>
                  </div>
                  {preview.stats.bounds.maxX > preview.stats.bounds.minX && (
                    <div>
                      <dt>Extensión</dt>
                      <dd>
                        {Math.round(preview.stats.bounds.maxX - preview.stats.bounds.minX)} ×{' '}
                        {Math.round(preview.stats.bounds.maxY - preview.stats.bounds.minY)} u
                      </dd>
                    </div>
                  )}
                </dl>
                {preview.stats.sampleLabels.length > 0 && (
                  <div className={styles.sampleLabels}>
                    <span className={styles.sampleTitle}>Etiquetas</span>
                    <code>{preview.stats.sampleLabels.join(' · ')}</code>
                  </div>
                )}
                {tab !== 'template' && (
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={mapPreview}
                      onChange={(e) => setMapPreview(e.target.checked)}
                      disabled={!preview.seats.length && tab !== 'ga'}
                    />
                    Mostrar fantasma en el mapa
                  </label>
                )}
              </>
            ) : (
              <p className={styles.hint}>Ajusta los parámetros para ver la previsualización.</p>
            )}
          </aside>
        </div>

        <footer className={styles.footer}>
          <span className={styles.shortcutHint}>
            Atajo: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>
          </span>
          <div className={styles.footerActions}>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              disabled={!canApply || (needsActiveSection && !activeSection)}
              onClick={handleApply}
            >
              Aplicar al mapa
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
