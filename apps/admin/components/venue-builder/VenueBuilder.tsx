'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { SeatMapRenderer } from '@boletera/venue-engine/render';
import type { LayoutTemplateId } from '@boletera/venue-engine';
import { CanvasHost } from './canvas/CanvasHost';
import { RendererProvider, type RendererHandle } from './canvas/renderer-context';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { BulkToolsPanel } from './panels/BulkToolsPanel';
import { ImportExportPanel } from './panels/ImportExportPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { ShortcutsOverlay } from './panels/ShortcutsOverlay';
import { StatusBar } from './panels/StatusBar';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { Toolbar } from './panels/Toolbar';
import { ValidationPanel } from './panels/ValidationPanel';
import {
  createVenueBuilderStores,
  useEditor,
  useVenueBuilderStores,
  VenueBuilderStoreProvider,
  type VenueBuilderStores,
} from './store/store-context';
import type { RightPanelId } from './store/types';
import { ToolRuntimeProvider } from './tools/tool-runtime';
import styles from './VenueBuilder.module.scss';

export type VenueBuilderProps = {
  initial: SeatMapData;
  onSave: (map: SeatMapData) => Promise<void>;
  onApplyTemplate?: (template: LayoutTemplateId) => Promise<SeatMapData>;
  onAiSuggest?: (description: string) => Promise<SeatMapData | SeatMapSection[]>;
  venueId?: string;
  getAuthToken?: () => string | null;
};

const RIGHT_TABS: Array<{ id: RightPanelId; label: string }> = [
  { id: 'properties', label: 'Propiedades' },
  { id: 'templates', label: 'Plantillas' },
  { id: 'bulk', label: 'Masivo' },
  { id: 'validation', label: 'Validar' },
  { id: 'io', label: 'Importar' },
];

const VenueBuilderShell = memo(function VenueBuilderShell({
  onSave,
  onApplyTemplate,
  onAiSuggest,
  venueId,
  getAuthToken,
}: Omit<VenueBuilderProps, 'initial'>) {
  const [saving, setSaving] = useState(false);
  const stores = useVenueBuilderStores();
  const leftOpen = useEditor((state) => state.leftPanelOpen);
  const rightOpen = useEditor((state) => state.rightPanelOpen);
  const rightPanel = useEditor((state) => state.rightPanel);
  const fullscreen = useEditor((state) => state.fullscreen);

  const handleSave = useCallback(async () => {
    const editor = stores.editor.getState();
    setSaving(true);
    try {
      await onSave(editor.scene);
      editor.markSaved();
      editor.setStatus('Mapa guardado');
    } catch (err) {
      editor.setStatus(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }, [onSave, stores]);

  useKeyboardShortcuts(() => {
    void handleSave();
  });

  return (
    <div className={fullscreen ? `${styles.root} ${styles.rootFullscreen}` : styles.root}>
      <Toolbar onSave={() => void handleSave()} saving={saving} />
      <div className={styles.body}>
        {leftOpen && (
          <aside className={styles.leftPanel} aria-label="Capas">
            <LayersPanel />
          </aside>
        )}
        <main className={styles.stage}>
          <CanvasHost />
        </main>
        {rightOpen && (
          <aside className={styles.rightPanel} aria-label="Propiedades">
            <div className={styles.panelTabs} role="tablist">
              {RIGHT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={rightPanel === tab.id}
                  className={rightPanel === tab.id ? styles.panelTabActive : styles.panelTab}
                  onClick={() => stores.editor.getState().setRightPanel(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={styles.panelScroll}>
              {rightPanel === 'properties' && <PropertiesPanel />}
              {rightPanel === 'templates' && (
                <TemplatesPanel onApplyTemplate={onApplyTemplate} onAiSuggest={onAiSuggest} />
              )}
              {rightPanel === 'bulk' && <BulkToolsPanel />}
              {rightPanel === 'validation' && (
                <ValidationPanel venueId={venueId} getAuthToken={getAuthToken} />
              )}
              {rightPanel === 'io' && <ImportExportPanel />}
            </div>
          </aside>
        )}
      </div>
      <StatusBar />
      <ShortcutsOverlay />
    </div>
  );
});

/**
 * Top-level editor composition: stores → renderer → tools → chrome.
 * The SeatMapRenderer instance is created here and handed to CanvasHost via context.
 */
export function VenueBuilder(props: VenueBuilderProps) {
  const storesRef = useRef<VenueBuilderStores | null>(null);
  if (!storesRef.current) storesRef.current = createVenueBuilderStores(props.initial);
  const stores = storesRef.current;

  const rendererRef = useRef<SeatMapRenderer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const renderer = new SeatMapRenderer({ background: '#0b0f14' });
    rendererRef.current = renderer;
    setReady(true);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    stores.editor.getState().loadScene(props.initial, { fit: true, keepSelection: false });
    stores.history.getState().reset();
  }, [props.initial, stores]);

  const handle = useMemo<RendererHandle>(() => ({ ref: rendererRef, ready }), [ready]);

  return (
    <VenueBuilderStoreProvider stores={stores}>
      <RendererProvider handle={handle}>
        <ToolRuntimeProvider>
          <VenueBuilderShell
            onSave={props.onSave}
            onApplyTemplate={props.onApplyTemplate}
            onAiSuggest={props.onAiSuggest}
            venueId={props.venueId}
            getAuthToken={props.getAuthToken}
          />
        </ToolRuntimeProvider>
      </RendererProvider>
    </VenueBuilderStoreProvider>
  );
}
