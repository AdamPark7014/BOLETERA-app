'use client';

import { memo, useState } from 'react';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import {
  generateLayoutTemplate,
  type LayoutTemplateId,
} from '@boletera/venue-engine';
import { replaceScene } from '../bulk/bulk-ops';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import type { TransformContext } from '../transform/transform-ops';
import { AiSuggestPanel } from './AiSuggestPanel';
import { Field, PanelSection } from './Panel';
import styles from '../VenueBuilder.module.scss';

const TEMPLATES: Array<{ id: LayoutTemplateId; label: string; hint: string }> = [
  { id: 'arena', label: 'Arena', hint: 'Bowl alrededor del escenario' },
  { id: 'theater', label: 'Teatro', hint: 'Platea frontal + balcones' },
  { id: 'stadium', label: 'Estadio', hint: 'Capacidad alta por zonas' },
  { id: 'festival', label: 'Festival', hint: 'GA + perímetro' },
];

export type TemplatesPanelProps = {
  onApplyTemplate?: (template: LayoutTemplateId) => Promise<SeatMapData>;
  onAiSuggest?: (description: string) => Promise<SeatMapData | SeatMapSection[]>;
};

export const TemplatesPanel = memo(function TemplatesPanel({
  onApplyTemplate,
  onAiSuggest,
}: TemplatesPanelProps) {
  const stores = useVenueBuilderStores();
  const busy = useEditor((state) => state.busy);
  const [capacity, setCapacity] = useState(4000);
  const [error, setError] = useState<string | null>(null);

  const ctx: TransformContext = {
    editor: stores.editor,
    history: stores.history.getState(),
  };

  const apply = async (id: LayoutTemplateId) => {
    setError(null);
    stores.editor.getState().setBusy({ label: `Aplicando plantilla ${id}…`, progress: 0.3 });
    try {
      const next = onApplyTemplate
        ? await onApplyTemplate(id)
        : generateLayoutTemplate(id, { capacity });
      replaceScene(ctx, `Plantilla ${id}`, next);
      stores.editor.getState().setStatus(`Plantilla ${id} aplicada`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar la plantilla');
    } finally {
      stores.editor.getState().setBusy(null);
    }
  };

  return (
    <>
      <PanelSection title="Plantillas">
        <Field label="Capacidad objetivo">
          <input
            className={styles.input}
            type="number"
            min={100}
            step={100}
            value={capacity}
            onChange={(event) => setCapacity(Math.max(100, Number(event.target.value) || 100))}
          />
        </Field>
        <div className={styles.templateGrid}>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={styles.templateCard}
              disabled={Boolean(busy)}
              onClick={() => void apply(template.id)}
            >
              <strong>{template.label}</strong>
              <span>{template.hint}</span>
            </button>
          ))}
        </div>
        <p className={styles.emptyHint}>
          {onApplyTemplate
            ? 'Se aplicará en el servidor y se sincronizará con el venue.'
            : 'Generación local con layout-templates del motor.'}
        </p>
      </PanelSection>

      {onAiSuggest ? (
        <AiSuggestPanel onAiSuggest={onAiSuggest} />
      ) : (
        <PanelSection title="IA de layout" defaultOpen={false}>
          <p className={styles.emptyHint}>
            Sin generador de IA conectado. Usa plantillas o conecta `onAiSuggest` /
            `useSuggestLayout` en la página del venue.
          </p>
        </PanelSection>
      )}

      {error && <p className={styles.errorText}>{error}</p>}
    </>
  );
});
