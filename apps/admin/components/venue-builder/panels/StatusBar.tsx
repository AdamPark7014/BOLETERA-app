'use client';

import { memo, useEffect, useState } from 'react';
import type { RenderStats } from '@boletera/venue-engine/render';
import { useRendererHandle } from '../canvas/renderer-context';
import { useEditor } from '../store/store-context';
import { selectTotalSeats } from '../store/selectors';
import { useToolRuntime } from '../tools/tool-runtime';
import styles from '../VenueBuilder.module.scss';

const POLL_MS = 500;

const LOD_LABEL: Record<RenderStats['lod'], string> = {
  sections: 'zonas',
  rows: 'filas',
  seats: 'asientos',
};

export const StatusBar = memo(function StatusBar() {
  const handle = useRendererHandle();
  const runtime = useToolRuntime();
  const tool = useEditor((state) => state.tool);
  const selectionCount = useEditor((state) => state.selection.seatIds.length);
  const totalSeats = useEditor((state) => selectTotalSeats(state.scene));
  const sectionCount = useEditor((state) => state.scene.sections.length);
  const busy = useEditor((state) => state.busy);
  const status = useEditor((state) => state.status);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!handle.ready) return undefined;
    const timer = window.setInterval(() => {
      const renderer = handle.ref.current;
      if (!renderer) return;
      setStats(renderer.getStats());
      setZoom(renderer.camera.zoom);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [handle]);

  return (
    <footer className={styles.statusBar}>
      <span className={styles.statusItem}>
        <strong className={styles.statusStrong}>{runtime.tools[tool].label}</strong>
        <span className={styles.statusHint}>{runtime.tools[tool].hint}</span>
      </span>

      {busy && (
        <span className={styles.statusItem}>
          <span className={styles.busyBar}>
            <span className={styles.busyFill} style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </span>
          {busy.label}
        </span>
      )}

      {status && <span className={styles.statusItem}>{status}</span>}

      <span className={styles.toolbarSpacer} />

      <span className={styles.statusItem} title="Asientos seleccionados">
        Sel. <strong className={styles.statusStrong}>{selectionCount.toLocaleString('es-MX')}</strong>
      </span>
      <span className={styles.statusItem} title="Zonas · asientos totales">
        {sectionCount} zonas ·{' '}
        <strong className={styles.statusStrong}>{totalSeats.toLocaleString('es-MX')}</strong> asientos
      </span>
      <span className={styles.statusItem} title="Asientos dibujados / descartados por culling">
        {(stats?.seatsDrawn ?? 0).toLocaleString('es-MX')} vis ·{' '}
        {(stats?.seatsCulled ?? 0).toLocaleString('es-MX')} culled
      </span>
      <span className={styles.statusItem}>Zoom {Math.round(zoom * 100)}%</span>
      <span className={styles.statusItem} title="Nivel de detalle activo">
        LOD {stats ? LOD_LABEL[stats.lod] : '—'}
      </span>
      <span className={styles.statusItem} title="Cuadros por segundo del motor">
        <strong className={styles.statusStrong}>{Math.round(stats?.fps ?? 0)}</strong> fps
      </span>
      <span className={styles.statusItem}>{stats?.backend === 'webgl2' ? 'WebGL2' : 'Canvas2D'}</span>
    </footer>
  );
});
