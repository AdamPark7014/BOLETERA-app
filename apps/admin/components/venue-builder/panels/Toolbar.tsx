'use client';

import { memo } from 'react';
import { useRendererHandle } from '../canvas/renderer-context';
import { useEditor, useHistory, useVenueBuilderStores } from '../store/store-context';
import { TOOL_ORDER } from '../tools/registry';
import { useToolRuntime } from '../tools/tool-runtime';
import {
  alignSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  rotateSelection,
  type TransformContext,
} from '../transform/transform-ops';
import { sceneBoundsOrDefault } from '../utils/geometry';
import { ColorModeSwitcher } from './ColorModeSwitcher';
import styles from '../VenueBuilder.module.scss';

export const Toolbar = memo(function Toolbar({
  onSave,
  saving,
}: {
  onSave: () => void;
  saving: boolean;
}) {
  const stores = useVenueBuilderStores();
  const runtime = useToolRuntime();
  const handle = useRendererHandle();
  const tool = useEditor((state) => state.tool);
  const snapEnabled = useEditor((state) => state.snapEnabled);
  const gridVisible = useEditor((state) => state.layers.grid.visible);
  const dirty = useEditor((state) => state.dirty);
  const fullscreen = useEditor((state) => state.fullscreen);
  const leftOpen = useEditor((state) => state.leftPanelOpen);
  const rightOpen = useEditor((state) => state.rightPanelOpen);
  const selectionCount = useEditor((state) => state.selection.seatIds.length);
  const canUndo = useHistory((state) => state.past.length > 0);
  const canRedo = useHistory((state) => state.future.length > 0);
  const undoLabel = useHistory((state) => state.past[state.past.length - 1]?.label ?? '');
  const redoLabel = useHistory((state) => state.future[0]?.label ?? '');

  const ctx: TransformContext = { editor: stores.editor, history: stores.history.getState() };
  const editor = stores.editor.getState;
  const hasSelection = selectionCount > 0;

  return (
    <header className={styles.topbar}>
      <div className={styles.toolGroup} role="group" aria-label="Herramientas">
        {TOOL_ORDER.map((id) => {
          const definition = runtime.tools[id];
          return (
            <button
              key={id}
              type="button"
              className={id === tool ? styles.toolBtnActive : styles.toolBtn}
              onClick={() => editor().setTool(id)}
              title={`${definition.label} (${definition.shortcut}) — ${definition.hint}`}
            >
              {definition.label}
            </button>
          );
        })}
      </div>

      <div className={styles.toolGroup} role="group" aria-label="Historial">
        <button
          type="button"
          className={styles.toolBtn}
          disabled={!canUndo}
          onClick={() => stores.history.getState().undo()}
          title={undoLabel ? `Deshacer: ${undoLabel}` : 'Deshacer'}
        >
          ↶
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={!canRedo}
          onClick={() => stores.history.getState().redo()}
          title={redoLabel ? `Rehacer: ${redoLabel}` : 'Rehacer'}
        >
          ↷
        </button>
      </div>

      <div className={styles.toolGroup} role="group" aria-label="Transformar">
        <button
          type="button"
          className={styles.toolBtn}
          disabled={!hasSelection}
          onClick={() => rotateSelection(ctx, 15)}
          title="Rotar 15° (])"
        >
          ⟳
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={!hasSelection}
          onClick={() => duplicateSelection(ctx, { x: 24, y: 24 })}
          title="Duplicar (Ctrl/⌘+D)"
        >
          ⧉
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={selectionCount < 2}
          onClick={() => groupSelection(ctx)}
          title="Agrupar en zona (Ctrl/⌘+G)"
        >
          ⬚
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={selectionCount < 2}
          onClick={() => alignSelection(ctx, 'left')}
          title="Alinear a la izquierda"
        >
          ⇤
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={selectionCount < 3}
          onClick={() => distributeSelection(ctx, 'x')}
          title="Distribuir horizontalmente"
        >
          ⇹
        </button>
      </div>

      <ColorModeSwitcher />

      <div className={styles.toolGroup} role="group" aria-label="Vista">
        <button
          type="button"
          className={snapEnabled ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor().setSnapEnabled(!snapEnabled)}
          title="Imán / rejilla magnética"
        >
          Imán
        </button>
        <button
          type="button"
          className={gridVisible ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor().setLayerFlag('grid', 'visible', !gridVisible)}
          title="Rejilla y reglas"
        >
          Rejilla
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            const renderer = handle.ref.current;
            if (renderer) {
              renderer.camera.fitToBounds(sceneBoundsOrDefault(editor().scene), 64, true);
            }
          }}
          title="Encuadrar todo (0)"
        >
          Encuadrar
        </button>
      </div>

      <div className={styles.toolbarSpacer} />

      <div className={styles.toolGroup} role="group" aria-label="Paneles">
        <button
          type="button"
          className={leftOpen ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor().setLeftPanelOpen(!leftOpen)}
          title="Panel de capas"
        >
          ▤
        </button>
        <button
          type="button"
          className={rightOpen ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor().setRightPanelOpen(!rightOpen)}
          title="Panel de propiedades"
        >
          ▥
        </button>
        <button
          type="button"
          className={fullscreen ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor().setFullscreen(!fullscreen)}
          title="Pantalla completa"
        >
          ⛶
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => editor().setShortcutsOpen(true)}
          title="Atajos de teclado (?)"
        >
          ?
        </button>
      </div>

      <button type="button" className={styles.primaryBtn} onClick={onSave} disabled={saving}>
        {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}
      </button>
    </header>
  );
});
