'use client';

import { memo } from 'react';
import type { LayerId } from '@boletera/venue-engine/render';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import { setSectionLocked, ungroupSection, type TransformContext } from '../transform/transform-ops';
import { updateSectionCommand } from '../store/commands';
import { PanelSection } from './Panel';
import { Legend } from './Legend';
import styles from '../VenueBuilder.module.scss';

const ENGINE_LAYERS: Array<{ id: LayerId; label: string }> = [
  { id: 'sections', label: 'Zonas' },
  { id: 'rows', label: 'Filas (LOD medio)' },
  { id: 'seats', label: 'Asientos' },
  { id: 'furniture', label: 'Mobiliario' },
  { id: 'stage', label: 'Escenario' },
  { id: 'analysis', label: 'Análisis' },
  { id: 'grid', label: 'Rejilla y reglas' },
  { id: 'interaction', label: 'Selección' },
];

export const LayersPanel = memo(function LayersPanel() {
  const stores = useVenueBuilderStores();
  const layers = useEditor((state) => state.layers);
  const sections = useEditor((state) => state.scene.sections);
  const hidden = useEditor((state) => state.hiddenSectionIds);
  const activeSectionId = useEditor((state) => state.activeSectionId);
  const selectedSections = useEditor((state) => state.selection.sectionIds);

  const ctx: TransformContext = { editor: stores.editor, history: stores.history.getState() };
  const editor = stores.editor.getState;

  return (
    <>
      <PanelSection title="Capas del motor">
        <ul className={styles.list}>
          {ENGINE_LAYERS.map((layer) => (
            <li key={layer.id} className={styles.listRow}>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={`Visibilidad de ${layer.label}`}
                onClick={() =>
                  editor().setLayerFlag(layer.id, 'visible', !layers[layer.id].visible)
                }
              >
                {layers[layer.id].visible ? '◉' : '○'}
              </button>
              <span className={styles.listName}>{layer.label}</span>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={`Bloqueo de ${layer.label}`}
                onClick={() => editor().setLayerFlag(layer.id, 'locked', !layers[layer.id].locked)}
              >
                {layers[layer.id].locked ? '🔒' : '🔓'}
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Zonas" badge={String(sections.length)}>
        {sections.length === 0 && (
          <p className={styles.emptyHint}>
            Aún no hay zonas. Dibuja una con la herramienta Zona (S) o aplica una plantilla.
          </p>
        )}
        <ul className={styles.list}>
          {sections.map((section) => {
            const isHidden = hidden.includes(section.id);
            const isActive =
              section.id === activeSectionId || selectedSections.includes(section.id);
            return (
              <li key={section.id} className={isActive ? styles.listRowActive : styles.listRow}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Visibilidad de ${section.name}`}
                  onClick={() => editor().toggleSectionHidden(section.id)}
                >
                  {isHidden ? '○' : '◉'}
                </button>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={section.color}
                  aria-label={`Color de ${section.name}`}
                  onChange={(event) =>
                    stores.history.getState().execute(
                      updateSectionCommand(
                        'Color de zona',
                        section.id,
                        { color: section.color },
                        { color: event.target.value },
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.listName}
                  onClick={() => editor().selectSection(section.id)}
                  title={`${section.seats.length} asientos`}
                >
                  {section.name}
                  <em className={styles.listMeta}>{section.seats.length}</em>
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Desagrupar ${section.name}`}
                  onClick={() => ungroupSection(ctx, section.id)}
                  title="Desagrupar por filas"
                >
                  ⌗
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Bloquear ${section.name}`}
                  onClick={() => setSectionLocked(ctx, section.id, !section.locked)}
                >
                  {section.locked ? '🔒' : '🔓'}
                </button>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      <PanelSection title="Leyenda">
        <Legend />
      </PanelSection>
    </>
  );
});
