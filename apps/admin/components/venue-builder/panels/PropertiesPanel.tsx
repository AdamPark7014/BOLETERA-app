'use client';

import { memo } from 'react';
import type { SeatMapSection } from '@boletera/shared';
import { mapToMeters } from '@boletera/venue-engine';
import {
  poseOf,
  setSeatAttributesCommand,
  setVenueMetaCommand,
  transformSeatsCommand,
  updateSectionCommand,
} from '../store/commands';
import { venueScale } from '../store/editor-store';
import { selectSeatIndex, selectSelectionBounds } from '../store/selectors';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import {
  alignSelection,
  distributeSelection,
  rotateSelection,
  scaleSelection,
  type TransformContext,
} from '../transform/transform-ops';
import { distance } from '../utils/geometry';
import { Field, PanelSection } from './Panel';
import styles from '../VenueBuilder.module.scss';

function numberOrKeep(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SectionProperties = memo(function SectionProperties({
  section,
  ctx,
}: {
  section: SeatMapSection;
  ctx: TransformContext;
}) {
  const patch = (
    label: string,
    before: Parameters<typeof updateSectionCommand>[2],
    after: Parameters<typeof updateSectionCommand>[3],
  ) => ctx.history.execute(updateSectionCommand(label, section.id, before, after));

  return (
    <PanelSection title="Zona">
      <Field label="Nombre">
        <input
          className={styles.input}
          value={section.name}
          onChange={(event) => patch('Renombrar zona', { name: section.name }, { name: event.target.value })}
        />
      </Field>
      <div className={styles.fieldRow}>
        <Field label="Color">
          <input
            type="color"
            className={styles.colorInput}
            value={section.color}
            onChange={(event) => patch('Color de zona', { color: section.color }, { color: event.target.value })}
          />
        </Field>
        <Field label="Nivel">
          <input
            className={styles.input}
            value={section.levelId ?? ''}
            placeholder="platea, balcón…"
            onChange={(event) =>
              patch(
                'Nivel de zona',
                { levelId: section.levelId },
                { levelId: event.target.value || undefined },
              )
            }
          />
        </Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="Paso asiento">
          <input
            className={styles.input}
            type="number"
            value={section.seatPitch ?? 26}
            onChange={(event) =>
              patch(
                'Paso de asiento',
                { seatPitch: section.seatPitch },
                { seatPitch: numberOrKeep(event.target.value, section.seatPitch ?? 26) },
              )
            }
          />
        </Field>
        <Field label="Paso fila">
          <input
            className={styles.input}
            type="number"
            value={section.rowPitch ?? 28}
            onChange={(event) =>
              patch(
                'Paso de fila',
                { rowPitch: section.rowPitch },
                { rowPitch: numberOrKeep(event.target.value, section.rowPitch ?? 28) },
              )
            }
          />
        </Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="Rake">
          <input
            className={styles.input}
            type="number"
            value={section.rake ?? 0}
            onChange={(event) =>
              patch(
                'Rake de zona',
                { rake: section.rake },
                { rake: numberOrKeep(event.target.value, section.rake ?? 0) },
              )
            }
          />
        </Field>
        <Field label="Curvatura">
          <input
            className={styles.input}
            type="number"
            step="0.1"
            value={section.curvature ?? 0}
            onChange={(event) =>
              patch(
                'Curvatura de zona',
                { curvature: section.curvature },
                { curvature: numberOrKeep(event.target.value, section.curvature ?? 0) },
              )
            }
          />
        </Field>
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={Boolean(section.locked)}
          onChange={(event) =>
            patch('Bloqueo de zona', { locked: section.locked }, { locked: event.target.checked })
          }
        />
        Bloquear geometría de la zona
      </label>
      <p className={styles.emptyHint}>
        {section.seats.length.toLocaleString('es-MX')} asientos ·{' '}
        {section.blocks?.length ?? 0} bloques paramétricos
      </p>
    </PanelSection>
  );
});

export const PropertiesPanel = memo(function PropertiesPanel() {
  const stores = useVenueBuilderStores();
  const scene = useEditor((state) => state.scene);
  const selection = useEditor((state) => state.selection);
  const activeSectionId = useEditor((state) => state.activeSectionId);
  const annotations = useEditor((state) => state.annotations);
  const measurements = useEditor((state) => state.measurements);
  const snapPitch = useEditor((state) => state.snapPitch);

  const bounds = selectSelectionBounds(scene, selection.seatIds);
  const ctx: TransformContext = { editor: stores.editor, history: stores.history.getState() };
  const editor = stores.editor.getState;
  const scale = venueScale(scene);

  const note = annotations.find((item) => selection.annotationIds.includes(item.id));
  if (note) {
    return (
      <PanelSection title="Nota">
        <Field label="Texto">
          <textarea
            className={styles.input}
            rows={4}
            value={note.text}
            onChange={(event) => editor().updateAnnotation(note.id, event.target.value)}
          />
        </Field>
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={() => editor().removeOverlayItems({ annotationIds: [note.id] })}
        >
          Eliminar nota
        </button>
      </PanelSection>
    );
  }

  const measurement = measurements.find((item) => selection.measurementIds.includes(item.id));
  if (measurement) {
    return (
      <PanelSection title="Medición">
        <p className={styles.emptyHint}>
          {mapToMeters(distance(measurement.a, measurement.b), scale).toFixed(2)} m ·{' '}
          {Math.round(distance(measurement.a, measurement.b))} unidades de mapa
        </p>
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={() => editor().removeOverlayItems({ measurementIds: [measurement.id] })}
        >
          Eliminar medición
        </button>
      </PanelSection>
    );
  }

  if (selection.stage && scene.venue?.stage) {
    const stage = scene.venue.stage;
    const patchStage = (next: Partial<typeof stage>) =>
      stores.history
        .getState()
        .execute(setVenueMetaCommand('Ajustar escenario', { stage }, { stage: { ...stage, ...next } }));
    return (
      <PanelSection title="Escenario">
        <div className={styles.fieldRow}>
          <Field label="X">
            <input
              className={styles.input}
              type="number"
              value={Math.round(stage.x)}
              onChange={(event) => patchStage({ x: numberOrKeep(event.target.value, stage.x) })}
            />
          </Field>
          <Field label="Y">
            <input
              className={styles.input}
              type="number"
              value={Math.round(stage.y)}
              onChange={(event) => patchStage({ y: numberOrKeep(event.target.value, stage.y) })}
            />
          </Field>
        </div>
        <div className={styles.fieldRow}>
          <Field label="Ancho">
            <input
              className={styles.input}
              type="number"
              value={Math.round(stage.width)}
              onChange={(event) =>
                patchStage({ width: Math.max(20, numberOrKeep(event.target.value, stage.width)) })
              }
            />
          </Field>
          <Field label="Rotación °">
            <input
              className={styles.input}
              type="number"
              value={stage.rotation ?? 0}
              onChange={(event) =>
                patchStage({ rotation: numberOrKeep(event.target.value, stage.rotation ?? 0) })
              }
            />
          </Field>
        </div>
        <Field label="Elevación">
          <input
            className={styles.input}
            type="number"
            value={stage.elevation ?? 0}
            onChange={(event) =>
              patchStage({ elevation: numberOrKeep(event.target.value, stage.elevation ?? 0) })
            }
          />
        </Field>
        <p className={styles.emptyHint}>
          Ancho equivalente: {mapToMeters(stage.width, scale).toFixed(2)} m
        </p>
      </PanelSection>
    );
  }

  const furnitureId = selection.furnitureIds[0];
  const furniture = (scene.venue?.furniture ?? []).find((item) => item.id === furnitureId);
  if (furniture) {
    const list = scene.venue?.furniture ?? [];
    const patchItem = (next: Partial<typeof furniture>) =>
      stores.history.getState().execute(
        setVenueMetaCommand(
          'Ajustar mobiliario',
          { furniture: list },
          {
            furniture: list.map((item) => (item.id === furniture.id ? { ...item, ...next } : item)),
          },
        ),
      );
    return (
      <PanelSection title="Mobiliario">
        <Field label="Tipo">
          <select
            className={styles.select}
            value={furniture.type}
            onChange={(event) =>
              patchItem({ type: event.target.value as typeof furniture.type })
            }
          >
            <option value="led">Pantalla LED</option>
            <option value="speaker">Audio</option>
            <option value="door">Puerta / salida</option>
          </select>
        </Field>
        <div className={styles.fieldRow}>
          <Field label="X">
            <input
              className={styles.input}
              type="number"
              value={Math.round(furniture.x)}
              onChange={(event) => patchItem({ x: numberOrKeep(event.target.value, furniture.x) })}
            />
          </Field>
          <Field label="Y">
            <input
              className={styles.input}
              type="number"
              value={Math.round(furniture.y)}
              onChange={(event) => patchItem({ y: numberOrKeep(event.target.value, furniture.y) })}
            />
          </Field>
        </div>
      </PanelSection>
    );
  }

  if (selection.seatIds.length === 1) {
    const hit = selectSeatIndex(scene).get(selection.seatIds[0]);
    if (hit) {
      const { seat } = hit;
      const attrs = { label: seat.label, row: seat.row, tier: seat.tier };
      const patchAttrs = (next: Partial<typeof attrs>) =>
        stores.history
          .getState()
          .execute(
            setSeatAttributesCommand('Editar asiento', [
              { id: seat.id, before: attrs, after: { ...attrs, ...next } },
            ]),
          );
      const patchPose = (next: { x?: number; y?: number }) => {
        const before = poseOf(seat);
        stores.history.getState().execute(
          transformSeatsCommand('Mover asiento', [
            { id: seat.id, before, after: { ...before, ...next } },
          ]),
        );
      };
      return (
        <>
          <PanelSection title="Asiento">
            <div className={styles.fieldRow}>
              <Field label="Etiqueta">
                <input
                  className={styles.input}
                  value={seat.label}
                  onChange={(event) => patchAttrs({ label: event.target.value })}
                />
              </Field>
              <Field label="Fila">
                <input
                  className={styles.input}
                  value={seat.row ?? ''}
                  onChange={(event) => patchAttrs({ row: event.target.value || undefined })}
                />
              </Field>
            </div>
            <Field label="Tier">
              <input
                className={styles.input}
                value={seat.tier ?? ''}
                onChange={(event) => patchAttrs({ tier: event.target.value || undefined })}
              />
            </Field>
            <div className={styles.fieldRow}>
              <Field label="X">
                <input
                  className={styles.input}
                  type="number"
                  value={Math.round(seat.x)}
                  onChange={(event) => patchPose({ x: numberOrKeep(event.target.value, seat.x) })}
                />
              </Field>
              <Field label="Y">
                <input
                  className={styles.input}
                  type="number"
                  value={Math.round(seat.y)}
                  onChange={(event) => patchPose({ y: numberOrKeep(event.target.value, seat.y) })}
                />
              </Field>
            </div>
            <p className={styles.emptyHint}>Zona: {hit.section.name}</p>
          </PanelSection>
          <SectionProperties section={hit.section} ctx={ctx} />
        </>
      );
    }
  }

  if (selection.seatIds.length > 1) {
    const width = bounds ? bounds.maxX - bounds.minX : 0;
    const height = bounds ? bounds.maxY - bounds.minY : 0;
    return (
      <PanelSection title={`${selection.seatIds.length.toLocaleString('es-MX')} asientos`}>
        <p className={styles.emptyHint}>
          Caja: {mapToMeters(width, scale).toFixed(2)} × {mapToMeters(height, scale).toFixed(2)} m
        </p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.ghostBtn} onClick={() => rotateSelection(ctx, -15)}>
            Rotar −15°
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => rotateSelection(ctx, 15)}>
            Rotar +15°
          </button>
        </div>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => scaleSelection(ctx, 0.9, 0.9)}
          >
            Escalar 90%
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => scaleSelection(ctx, 1.1, 1.1)}
          >
            Escalar 110%
          </button>
        </div>
        <div className={styles.btnRow}>
          <button type="button" className={styles.ghostBtn} onClick={() => alignSelection(ctx, 'left')}>
            Alinear ←
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => alignSelection(ctx, 'hcenter')}
          >
            Centrar ↔
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => alignSelection(ctx, 'top')}>
            Alinear ↑
          </button>
        </div>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => distributeSelection(ctx, 'x')}
          >
            Distribuir ↔
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => distributeSelection(ctx, 'y')}
          >
            Distribuir ↕
          </button>
        </div>
      </PanelSection>
    );
  }

  const activeSection = scene.sections.find((section) => section.id === activeSectionId);
  const venue = scene.venue ?? {};

  return (
    <>
      {activeSection && <SectionProperties section={activeSection} ctx={ctx} />}
      <PanelSection title="Venue">
        <div className={styles.fieldRow}>
          <Field label="Escala (u/m)">
            <input
              className={styles.input}
              type="number"
              value={venue.scale ?? 40}
              onChange={(event) =>
                stores.history.getState().execute(
                  setVenueMetaCommand(
                    'Escala del venue',
                    { scale: venue.scale },
                    { scale: Math.max(1, numberOrKeep(event.target.value, venue.scale ?? 40)) },
                  ),
                )
              }
            />
          </Field>
          <Field label="Paso de imán">
            <input
              className={styles.input}
              type="number"
              value={snapPitch}
              onChange={(event) => editor().setSnapPitch(numberOrKeep(event.target.value, 10))}
            />
          </Field>
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={Boolean(venue.cadLocks?.strictOverlaps)}
            onChange={(event) =>
              stores.history.getState().execute(
                setVenueMetaCommand(
                  'Solapes estrictos',
                  { cadLocks: venue.cadLocks },
                  {
                    cadLocks: { ...(venue.cadLocks ?? {}), strictOverlaps: event.target.checked },
                  },
                ),
              )
            }
          />
          Tratar solapes de asientos como errores
        </label>
        <p className={styles.emptyHint}>
          Selecciona asientos, una zona, el escenario o mobiliario para editar sus propiedades.
        </p>
      </PanelSection>
    </>
  );
});
