'use client';

import { memo, useEffect, useId, useRef, useState } from 'react';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { suggestTemplateFromPrompt } from '@boletera/venue-engine';
import { SeatMapRenderer } from '@boletera/venue-engine/render';
import { replaceScene } from '../bulk/bulk-ops';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import type { TransformContext } from '../transform/transform-ops';
import {
  diffLayouts,
  isEmptyProposal,
  type LayoutDiffSummary,
  type SectionDiffKind,
} from '../utils/layout-diff';
import { normalizeAiSuggestResult } from '../utils/normalize-ai-layout';
import { Field, PanelSection } from './Panel';
import panelStyles from '../VenueBuilder.module.scss';
import styles from './AiSuggestPanel.module.scss';

export type AiSuggestPanelProps = {
  onAiSuggest: (description: string) => Promise<SeatMapData | SeatMapSection[]>;
};

type PreviewState = {
  prompt: string;
  proposed: SeatMapData;
  diff: LayoutDiffSummary;
};

const KIND_LABEL: Record<SectionDiffKind, string> = {
  added: 'Nueva',
  removed: 'Eliminada',
  changed: 'Modificada',
  unchanged: 'Sin cambio',
};

const DIFF_ROW_CLASS: Record<SectionDiffKind, string> = {
  added: styles.diff_added,
  removed: styles.diff_removed,
  changed: styles.diff_changed,
  unchanged: styles.diff_unchanged,
};

const MiniMapPreview = memo(function MiniMapPreview({
  map,
  label,
  emptyLabel,
}: {
  map: SeatMapData | null;
  label: string;
  emptyLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const empty = !map || isEmptyProposal(map);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || empty || !map) return;

    const renderer = new SeatMapRenderer({
      background: '#070a0f',
      forceCanvas2d: true,
      seatRadius: 3,
    });
    renderer.mount(canvas);
    renderer.setScene(map);
    return () => {
      renderer.destroy();
    };
  }, [map, empty]);

  return (
    <figure className={styles.previewPane}>
      <figcaption className={styles.previewCaption}>{label}</figcaption>
      <div className={styles.previewHost}>
        {empty ? (
          <p className={styles.previewEmpty}>{emptyLabel}</p>
        ) : (
          <canvas ref={canvasRef} className={styles.previewCanvas} aria-label={label} />
        )}
      </div>
    </figure>
  );
});

function DiffSummary({ diff }: { diff: LayoutDiffSummary }) {
  const hasStructural =
    diff.sectionsAdded +
      diff.sectionsRemoved +
      diff.sectionsChanged +
      diff.seatsAdded +
      diff.seatsRemoved +
      diff.seatsMoved >
    0;

  if (!hasStructural) {
    return (
      <p className={panelStyles.emptyHint}>
        La propuesta es idéntica al mapa actual (mismas zonas y asientos).
      </p>
    );
  }

  return (
    <div className={styles.diffBlock}>
      <ul className={styles.diffStats} aria-label="Resumen del diff">
        <li>
          Capacidad <strong>{diff.capacityBefore}</strong> → <strong>{diff.capacityAfter}</strong>
        </li>
        <li>
          Zonas +{diff.sectionsAdded} / −{diff.sectionsRemoved} / ~{diff.sectionsChanged}
        </li>
        <li>
          Asientos +{diff.seatsAdded} / −{diff.seatsRemoved} / movidos {diff.seatsMoved}
        </li>
      </ul>
      {diff.sectionDetails.length === 0 ? (
        <p className={panelStyles.emptyHint}>Sin detalle de zonas.</p>
      ) : (
        <ul className={styles.diffList}>
          {diff.sectionDetails.map((row) => (
            <li key={`${row.kind}-${row.id}`} className={DIFF_ROW_CLASS[row.kind]}>
              <span className={styles.diffKind}>{KIND_LABEL[row.kind]}</span>
              <span className={styles.diffName}>{row.name}</span>
              <span className={styles.diffSeats}>
                {row.seatsBefore} → {row.seatsAfter}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const AiSuggestPanel = memo(function AiSuggestPanel({ onAiSuggest }: AiSuggestPanelProps) {
  const stores = useVenueBuilderStores();
  const busy = useEditor((state) => state.busy);
  const scene = useEditor((state) => state.scene);
  const titleId = useId();

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const ctx: TransformContext = {
    editor: stores.editor,
    history: stores.history.getState(),
  };

  const clearPreview = () => setPreview(null);

  const runSuggest = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setError(null);
    setLoading(true);
    stores.editor.getState().setBusy({ label: 'Generando layout con IA…', progress: 0.25 });
    try {
      const raw = await onAiSuggest(trimmed);
      const proposed = normalizeAiSuggestResult(raw, scene.venue);
      if (isEmptyProposal(proposed)) {
        setPreview(null);
        setError('La IA devolvió un layout vacío (0 zonas). Ajusta el prompt e inténtalo de nuevo.');
        return;
      }
      const current = stores.editor.getState().scene;
      const diff = diffLayouts(current, proposed);
      setPreview({ prompt: trimmed, proposed, diff });
      stores.editor.getState().setStatus(
        `Vista previa IA: ${proposed.sections.length} zonas · ${diff.capacityAfter} asientos`,
      );
    } catch (err) {
      setPreview(null);
      const hint = suggestTemplateFromPrompt(trimmed);
      setError(
        err instanceof Error
          ? `${err.message}. Sugerencia local: plantilla «${hint.template}» (~${hint.capacity}).`
          : `No se pudo generar la sugerencia. Prueba la plantilla local «${hint.template}».`,
      );
    } finally {
      setLoading(false);
      stores.editor.getState().setBusy(null);
    }
  };

  const applyPreview = () => {
    if (!preview) return;
    replaceScene(ctx, 'Sugerencia IA', preview.proposed);
    stores.editor.getState().setStatus(
      `Sugerencia IA aplicada (${preview.proposed.sections.length} zonas)`,
    );
    clearPreview();
    setPrompt('');
  };

  const discardPreview = () => {
    clearPreview();
    stores.editor.getState().setStatus('Sugerencia IA descartada');
  };

  const disabled = Boolean(busy) || loading;

  return (
    <>
      <PanelSection title="IA de layout">
        <Field label="Describe el venue">
          <textarea
            className={panelStyles.input}
            rows={3}
            value={prompt}
            placeholder="Arena para 8000, escenario al centro, platea VIP…"
            disabled={disabled}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Field>
        <div className={panelStyles.btnRow}>
          <button
            type="button"
            className={panelStyles.primaryBtn}
            disabled={disabled || !prompt.trim()}
            onClick={() => void runSuggest()}
          >
            {loading ? 'Generando…' : 'Generar preview'}
          </button>
        </div>
        <p className={panelStyles.emptyHint}>
          La propuesta se muestra en vista previa con diff. No se aplica al mapa hasta que
          confirmes.
        </p>
        {loading && (
          <p className={styles.loadingHint} role="status">
            Consultando IA… esto puede tardar unos segundos.
          </p>
        )}
        {!loading && !preview && !error && (
          <p className={panelStyles.emptyHint}>
            Sin preview todavía. Escribe un prompt y genera una sugerencia.
          </p>
        )}
      </PanelSection>

      {error && <p className={panelStyles.errorText}>{error}</p>}

      {preview && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={discardPreview}
        >
          <div className={styles.card} onClick={(event) => event.stopPropagation()}>
            <header className={styles.header}>
              <div>
                <h2 id={titleId}>Preview sugerencia IA</h2>
                <p className={styles.promptEcho}>«{preview.prompt}»</p>
              </div>
              <button
                type="button"
                className={panelStyles.iconBtn}
                aria-label="Descartar preview"
                onClick={discardPreview}
              >
                ✕
              </button>
            </header>

            <div className={styles.sideBySide}>
              <MiniMapPreview
                map={scene}
                label="Actual"
                emptyLabel="Mapa actual vacío"
              />
              <MiniMapPreview
                map={preview.proposed}
                label="Propuesta IA"
                emptyLabel="Propuesta vacía"
              />
            </div>

            <section className={styles.diffSection} aria-label="Diff de zonas y asientos">
              <h3 className={styles.diffTitle}>Diff</h3>
              <DiffSummary diff={preview.diff} />
            </section>

            <div className={styles.actions}>
              <button type="button" className={panelStyles.ghostBtn} onClick={discardPreview}>
                Descartar
              </button>
              <button type="button" className={panelStyles.primaryBtn} onClick={applyPreview}>
                Aplicar al mapa
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
