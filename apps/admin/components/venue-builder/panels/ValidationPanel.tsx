'use client';

import { memo, useState } from 'react';
import type { SeatMapData } from '@boletera/shared';
import type { AnalysisOverlay } from '@boletera/venue-engine/render';
import {
  buildEgressPathOverlays,
  buildEgressReport,
  calculateSightlines,
  egressReportFilename,
  exportEgressReportToCsv,
  resolveGeometry,
  validateGeometry,
} from '@boletera/venue-engine';
import { runIdle } from '../utils/chunked';
import { downloadText } from '../utils/download';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import type { ValidationState } from '../store/types';
import { PanelSection } from './Panel';
import styles from '../VenueBuilder.module.scss';

async function runValidation(scene: SeatMapData): Promise<ValidationState> {
  const resolved = await runIdle(() => resolveGeometry(scene));
  const geometry = await runIdle(() => validateGeometry(resolved));
  const sightlines = await runIdle(() => calculateSightlines(resolved));
  const egress = await runIdle(() => buildEgressReport(scene));
  const pathOverlay = await runIdle(() => buildEgressPathOverlays(resolved, { analysis: egress.analysis }));

  const sightlineBySeatId: Record<string, number> = {};
  for (const score of sightlines.scores) sightlineBySeatId[score.seatId] = score.score;

  const overlays: AnalysisOverlay[] = [
    {
      kind: 'egress',
      paths: [
        ...pathOverlay.paths.map((path) => ({
          points: path.points.map(([x, y]) => ({ x, y })),
          color: path.reachable ? '#22c55e' : '#f97316',
          width: 2,
        })),
        ...pathOverlay.bottlenecks.map((bn) => ({
          points: bn.points.map(([x, y]) => ({ x, y })),
          color: '#ef4444',
          width: 3,
        })),
      ],
    },
  ];

  return {
    ranAt: Date.now(),
    issues: geometry.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      seatIds: issue.seatIds,
      sectionIds: issue.sectionIds ?? [],
    })),
    sightlineSummary: sightlines.summary,
    sightlineBySeatId,
    egress: {
      hasNetwork: egress.summary.hasNetwork,
      clearanceMinutes: egress.summary.clearanceMinutes,
      unreachable: egress.summary.unreachable,
      maxPathLength: egress.summary.maxPathLength,
      exitCount: egress.summary.exitCount,
    },
    overlays,
  };
}

export type ValidationPanelProps = {
  venueId?: string;
  getAuthToken?: () => string | null;
};

export const ValidationPanel = memo(function ValidationPanel({
  venueId,
  getAuthToken,
}: ValidationPanelProps) {
  const stores = useVenueBuilderStores();
  const validation = useEditor((state) => state.validation);
  const busy = useEditor((state) => state.busy);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    const editor = stores.editor.getState();
    editor.setBusy({ label: 'Validando geometría…', progress: 0.15 });
    try {
      const result = await runValidation(editor.scene);
      editor.setValidation(result);
      editor.setColorMode('sightline');
      editor.setLayerFlag('analysis', 'visible', true);
      editor.setStatus(
        `${result.issues.length} hallazgos · visión ${Object.values(result.sightlineSummary ?? {}).reduce((a, b) => a + b, 0)} asientos`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falló la validación');
    } finally {
      stores.editor.getState().setBusy(null);
    }
  };

  const exportCsv = () => {
    const scene = stores.editor.getState().scene;
    const report = buildEgressReport(scene, { venueName: scene.sections[0]?.name });
    downloadText(egressReportFilename(report.venueName), exportEgressReportToCsv(report), 'text/csv');
  };

  const downloadServer = async (kind: 'csv' | 'pdf' | 'pdf-draft') => {
    if (!venueId) return;
    const token = getAuthToken?.() ?? localStorage.getItem('boletera_token');
    if (!token) {
      setError('Sesión no encontrada');
      return;
    }
    setError(null);
    stores.editor.getState().setBusy({ label: 'Descargando reporte…', progress: 0.4 });
    try {
      const api = await import('@/lib/platform-api');
      if (kind === 'csv') {
        try {
          await api.downloadVenueEgressCsv(token, venueId);
        } catch {
          const csv = await api.analyzeVenueEgress(token, venueId, {
            mapData: stores.editor.getState().scene,
            format: 'csv',
          });
          downloadText(
            egressReportFilename(stores.editor.getState().scene.sections[0]?.name ?? venueId),
            typeof csv === 'string' ? csv : String(csv),
            'text/csv',
          );
        }
      } else if (kind === 'pdf') {
        await api.downloadVenueEgressPdf(token, venueId);
      } else {
        await api.downloadVenueEgressPdfDraft(token, venueId, stores.editor.getState().scene);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el reporte');
    } finally {
      stores.editor.getState().setBusy(null);
    }
  };

  const selectIssue = (seatIds: string[], sectionIds: string[]) => {
    const editor = stores.editor.getState();
    if (seatIds.length > 0) editor.selectSeats(seatIds);
    else if (sectionIds[0]) editor.selectSection(sectionIds[0]);
  };

  return (
    <>
      <PanelSection title="Análisis">
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={Boolean(busy)}
          onClick={() => void run()}
        >
          Ejecutar validación
        </button>
        <p className={styles.emptyHint}>
          Geometría + circulación + visión + egress. Los overlays se envían al motor vía
          setAnalysisOverlays.
        </p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.ghostBtn} onClick={exportCsv}>
            CSV local
          </button>
          {venueId && (
            <>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => void downloadServer('csv')}
              >
                CSV servidor
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => void downloadServer('pdf-draft')}
              >
                PDF borrador
              </button>
            </>
          )}
        </div>
      </PanelSection>

      {validation && (
        <>
          <PanelSection
            title="Hallazgos"
            badge={String(validation.issues.length)}
            defaultOpen
          >
            {validation.issues.length === 0 ? (
              <p className={styles.emptyHint}>Sin hallazgos. La geometría está limpia.</p>
            ) : (
              <ul className={styles.issueList}>
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    <button
                      type="button"
                      className={
                        issue.severity === 'error' ? styles.issueError : styles.issueWarning
                      }
                      onClick={() => selectIssue(issue.seatIds, issue.sectionIds)}
                    >
                      <strong>{issue.severity === 'error' ? 'Error' : 'Aviso'}</strong>
                      <span>{issue.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>

          {validation.sightlineSummary && (
            <PanelSection title="Visión">
              <ul className={styles.statList}>
                {Object.entries(validation.sightlineSummary).map(([grade, count]) => (
                  <li key={grade}>
                    <span>{grade}</span>
                    <strong>{count.toLocaleString('es-MX')}</strong>
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

          {validation.egress && (
            <PanelSection title="Egress">
              <ul className={styles.statList}>
                <li>
                  <span>Red</span>
                  <strong>{validation.egress.hasNetwork ? 'Sí' : 'No'}</strong>
                </li>
                <li>
                  <span>Salidas</span>
                  <strong>{validation.egress.exitCount}</strong>
                </li>
                <li>
                  <span>Inalcanzables</span>
                  <strong>{validation.egress.unreachable}</strong>
                </li>
                <li>
                  <span>Vaciado</span>
                  <strong>
                    {validation.egress.clearanceMinutes != null
                      ? `${validation.egress.clearanceMinutes.toFixed(1)} min`
                      : '—'}
                  </strong>
                </li>
              </ul>
            </PanelSection>
          )}
        </>
      )}

      {error && <p className={styles.errorText}>{error}</p>}
    </>
  );
});
