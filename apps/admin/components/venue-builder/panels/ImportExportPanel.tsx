'use client';

import { memo, useRef, useState } from 'react';
import type { SeatMapData } from '@boletera/shared';
import {
  CAD_ENTITY_ROLES,
  commitCadImportReview,
  exportSeatMapToDxf,
  exportSeatMapToSvg,
  previewDxfCadImport,
  previewSvgCadImport,
  type CadEntityRole,
  type CadReviewPrimitive,
} from '@boletera/venue-engine';
import { replaceScene } from '../bulk/bulk-ops';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import type { TransformContext } from '../transform/transform-ops';
import { sceneBoundsOrDefault } from '../utils/geometry';
import { downloadText } from '../utils/download';
import { Field, PanelSection } from './Panel';
import styles from '../VenueBuilder.module.scss';

const ROLE_LABEL: Record<CadEntityRole, string> = {
  section: 'Zona',
  aisle: 'Pasillo',
  obstacle: 'Obstáculo',
  stage: 'Escenario',
  stairs: 'Escalera',
  exit: 'Salida',
  furniture: 'Mobiliario',
  focus: 'Foco',
  skip: 'Omitir',
};

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

export const ImportExportPanel = memo(function ImportExportPanel() {
  const stores = useVenueBuilderStores();
  const scene = useEditor((state) => state.scene);
  const underlay = useEditor((state) => state.underlay);
  const busy = useEditor((state) => state.busy);
  const [review, setReview] = useState<CadReviewPrimitive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const underlayRef = useRef<HTMLInputElement>(null);

  const ctx: TransformContext = {
    editor: stores.editor,
    history: stores.history.getState(),
  };
  const editor = stores.editor.getState;

  const importCad = async (file: File) => {
    setError(null);
    editor().setBusy({ label: 'Parseando CAD…', progress: 0.2 });
    try {
      const text = await readText(file);
      const lower = file.name.toLowerCase();
      const primitives = lower.endsWith('.dxf')
        ? previewDxfCadImport(text)
        : previewSvgCadImport(text);
      setReview(primitives);
      editor().setStatus(`${primitives.length} entidades en revisión`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Importación CAD fallida');
      setReview(null);
    } finally {
      editor().setBusy(null);
    }
  };

  const commitReview = (mode: 'merge' | 'replace-meta') => {
    if (!review) return;
    const result = commitCadImportReview(review, scene, { mode });
    replaceScene(ctx, `Importar CAD (${mode})`, result.map);
    setReview(null);
    editor().setStatus(
      `CAD: ${result.stats.sections} zonas · ${result.stats.aisles} pasillos · ${result.stats.exits} salidas`,
    );
  };

  const loadUnderlay = (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const bounds = sceneBoundsOrDefault(scene);
    const width = Math.max(400, bounds.maxX - bounds.minX);
    const height = Math.max(300, bounds.maxY - bounds.minY);
    if (underlay?.url.startsWith('blob:')) URL.revokeObjectURL(underlay.url);
    editor().setUnderlay({
      kind: isPdf ? 'pdf' : 'image',
      url,
      name: file.name,
      x: bounds.minX,
      y: bounds.minY,
      width,
      height,
      opacity: 0.45,
      visible: true,
    });
    editor().setStatus(
      isPdf
        ? 'PDF como referencia (visor nativo del navegador; para geometría usa DXF/SVG)'
        : 'Imagen de fondo cargada',
    );
  };

  const exportJson = () => {
    const payload: SeatMapData = scene;
    downloadText('seat-map.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  return (
    <>
      <PanelSection title="Exportar">
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => downloadText('seat-map.svg', exportSeatMapToSvg(scene), 'image/svg+xml')}
          >
            SVG
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => downloadText('seat-map.dxf', exportSeatMapToDxf(scene), 'application/dxf')}
          >
            DXF
          </button>
          <button type="button" className={styles.ghostBtn} onClick={exportJson}>
            JSON
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Importar CAD">
        <input
          ref={fileRef}
          type="file"
          accept=".svg,.dxf,image/svg+xml"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importCad(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={Boolean(busy)}
          onClick={() => fileRef.current?.click()}
        >
          Elegir SVG / DXF…
        </button>
        <p className={styles.emptyHint}>
          Revisión de entidades con previewDxfCadImport / previewSvgCadImport antes de
          commitCadImportReview.
        </p>

        {review && (
          <div className={styles.reviewBox}>
            <p className={styles.emptyHint}>{review.length} entidades</p>
            <ul className={styles.reviewList}>
              {review.slice(0, 40).map((item, index) => (
                <li key={item.id} className={styles.reviewRow}>
                  <span className={styles.listName} title={item.source}>
                    {item.name || item.id}
                  </span>
                  <select
                    className={styles.select}
                    value={item.role}
                    onChange={(event) => {
                      const role = event.target.value as CadEntityRole;
                      setReview((prev) =>
                        prev
                          ? prev.map((row, i) => (i === index ? { ...row, role } : row))
                          : prev,
                      );
                    }}
                  >
                    {CAD_ENTITY_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {review.length > 40 && (
              <p className={styles.emptyHint}>…y {review.length - 40} más</p>
            )}
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => commitReview('merge')}
              >
                Fusionar
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => commitReview('replace-meta')}
              >
                Reemplazar meta
              </button>
              <button type="button" className={styles.dangerBtn} onClick={() => setReview(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Fondo de referencia">
        <input
          ref={underlayRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadUnderlay(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => underlayRef.current?.click()}
        >
          Cargar imagen / PDF…
        </button>
        {underlay && (
          <>
            <Field label={`Opacidad (${Math.round(underlay.opacity * 100)}%)`}>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={underlay.opacity}
                onChange={(event) =>
                  editor().patchUnderlay({ opacity: Number(event.target.value) })
                }
              />
            </Field>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={underlay.visible}
                onChange={(event) => editor().patchUnderlay({ visible: event.target.checked })}
              />
              Visible
            </label>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => {
                if (underlay.url.startsWith('blob:')) URL.revokeObjectURL(underlay.url);
                editor().setUnderlay(null);
              }}
            >
              Quitar fondo
            </button>
            <p className={styles.emptyHint}>
              El PDF se muestra con el visor nativo del navegador (sin pdf.js). Para cotas y
              geometría editable, importa DXF o SVG.
            </p>
          </>
        )}
      </PanelSection>

      {error && <p className={styles.errorText}>{error}</p>}
    </>
  );
});
