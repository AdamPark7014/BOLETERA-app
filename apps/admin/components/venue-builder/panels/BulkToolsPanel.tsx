'use client';

import { memo, useState } from 'react';
import {
  assignTierToSelection,
  fillSectionWithSeats,
  generateBlockIntoScene,
  paintSelectionIntoSection,
  regenerateFromBlocks,
  renumberSelection,
} from '../bulk/bulk-ops';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import type { TransformContext } from '../transform/transform-ops';
import { sceneBoundsOrDefault } from '../utils/geometry';
import { Field, PanelSection } from './Panel';
import styles from '../VenueBuilder.module.scss';

export const BulkToolsPanel = memo(function BulkToolsPanel() {
  const stores = useVenueBuilderStores();
  const scene = useEditor((state) => state.scene);
  const selectionCount = useEditor((state) => state.selection.seatIds.length);
  const activeSectionId = useEditor((state) => state.activeSectionId);
  const drawParams = useEditor((state) => state.drawParams);
  const busy = useEditor((state) => state.busy);

  const [tier, setTier] = useState('vip');
  const [paintSectionId, setPaintSectionId] = useState('');
  const [startNumber, setStartNumber] = useState(1);
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [relabelRows, setRelabelRows] = useState(true);

  const ctx: TransformContext = {
    editor: stores.editor,
    history: stores.history.getState(),
  };
  const editor = stores.editor.getState;

  const origin = (() => {
    const bounds = sceneBoundsOrDefault(scene);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2 + 120,
    };
  })();

  return (
    <>
      <PanelSection title="Renumerar" badge={selectionCount ? String(selectionCount) : undefined}>
        <div className={styles.fieldRow}>
          <Field label="Inicio">
            <input
              className={styles.input}
              type="number"
              value={startNumber}
              onChange={(event) => setStartNumber(Number(event.target.value) || 1)}
            />
          </Field>
          <Field label="Dirección">
            <select
              className={styles.select}
              value={direction}
              onChange={(event) => setDirection(event.target.value as 'ltr' | 'rtl')}
            >
              <option value="ltr">Izq → der</option>
              <option value="rtl">Der → izq</option>
            </select>
          </Field>
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={relabelRows}
            onChange={(event) => setRelabelRows(event.target.checked)}
          />
          Relabelar filas (A, B, C…)
        </label>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={selectionCount === 0}
          onClick={() =>
            renumberSelection(ctx, {
              startNumber,
              direction,
              relabelRows,
              rowPrefix: '',
            })
          }
        >
          Renumerar selección
        </button>
      </PanelSection>

      <PanelSection title="Pintar / tier">
        <Field label="Tier">
          <input
            className={styles.input}
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          />
        </Field>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={selectionCount === 0 || !tier.trim()}
          onClick={() => assignTierToSelection(ctx, tier.trim())}
        >
          Asignar tier a selección
        </button>
        <Field label="Mover a zona">
          <select
            className={styles.select}
            value={paintSectionId}
            onChange={(event) => setPaintSectionId(event.target.value)}
          >
            <option value="">Elegir zona…</option>
            {scene.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={selectionCount === 0 || !paintSectionId}
          onClick={() => paintSelectionIntoSection(ctx, paintSectionId)}
        >
          Pintar zona
        </button>
      </PanelSection>

      <PanelSection title="Generar bloque">
        <p className={styles.emptyHint}>
          Usa los parámetros de dibujo activos ({drawParams.rows}×{drawParams.seatsPerRow}, pitch{' '}
          {drawParams.seatPitch}/{drawParams.rowPitch}).
        </p>
        <div className={styles.fieldRow}>
          <Field label="Filas">
            <input
              className={styles.input}
              type="number"
              value={drawParams.rows}
              onChange={(event) =>
                editor().setDrawParams({ rows: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </Field>
          <Field label="Asientos/fila">
            <input
              className={styles.input}
              type="number"
              value={drawParams.seatsPerRow}
              onChange={(event) =>
                editor().setDrawParams({
                  seatsPerRow: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
          </Field>
        </div>
        <div className={styles.fieldRow}>
          <Field label="Curvatura">
            <input
              className={styles.input}
              type="number"
              step="0.05"
              value={drawParams.curvature}
              onChange={(event) =>
                editor().setDrawParams({ curvature: Number(event.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Rake">
            <input
              className={styles.input}
              type="number"
              value={drawParams.rake}
              onChange={(event) => editor().setDrawParams({ rake: Number(event.target.value) || 0 })}
            />
          </Field>
        </div>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={Boolean(busy)}
          onClick={() =>
            void generateBlockIntoScene(
              ctx,
              {
                origin,
                rows: drawParams.rows,
                seatsPerRow: drawParams.seatsPerRow,
                seatPitch: drawParams.seatPitch,
                rowPitch: drawParams.rowPitch,
                rake: drawParams.rake,
                curvature: drawParams.curvature,
                yaw: 0,
                tier: drawParams.tier,
              },
              activeSectionId,
            ).then((count) => editor().setStatus(`Bloque: ${count.toLocaleString('es-MX')} asientos`))
          }
        >
          Generar en zona activa
        </button>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={!activeSectionId}
            onClick={() => {
              if (!activeSectionId) return;
              const count = fillSectionWithSeats(ctx, activeSectionId, {
                seatPitch: drawParams.seatPitch,
                rowPitch: drawParams.rowPitch,
                rake: drawParams.rake,
                tier: drawParams.tier,
              });
              editor().setStatus(`Relleno: ${count.toLocaleString('es-MX')} asientos`);
            }}
          >
            Rellenar contorno
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => {
              regenerateFromBlocks(ctx, activeSectionId ?? undefined);
              editor().setStatus('Regenerado desde bloques paramétricos');
            }}
          >
            Regenerar bloques
          </button>
        </div>
      </PanelSection>
    </>
  );
});
