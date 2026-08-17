'use client';

import styles from './Venue3DStudio.module.scss';

type StudioStatusBarProps = {
  seatCount: number;
  selectedLabel: string | null;
  cameraLabel: string;
  colorLabel: string;
  fps: number;
  qualityLabel: string;
};

export function StudioStatusBar({
  seatCount,
  selectedLabel,
  cameraLabel,
  colorLabel,
  fps,
  qualityLabel,
}: StudioStatusBarProps) {
  return (
    <footer className={styles.statusBar} aria-label="Estado del estudio">
      <div className={styles.statusMeta}>
        <span>{seatCount.toLocaleString('es-MX')} asientos visibles</span>
        <span>Cámara: {cameraLabel}</span>
        <span>Color: {colorLabel}</span>
        <span>Calidad: {qualityLabel}</span>
        {selectedLabel && <span>Seleccionado: {selectedLabel}</span>}
      </div>
      <span className={styles.fps} title="Fotogramas por segundo (diagnóstico)">
        {fps > 0 ? `${fps} FPS` : '— FPS'}
      </span>
    </footer>
  );
}
