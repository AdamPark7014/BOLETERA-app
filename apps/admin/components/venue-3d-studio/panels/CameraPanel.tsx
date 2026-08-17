'use client';

import type { CameraPreset } from '../types';
import { CAMERA_PRESET_LABELS } from '../types';
import styles from '../Venue3DStudio.module.scss';

type CameraPanelProps = {
  camera: CameraPreset;
  reducedMotion: boolean;
  onChange: (preset: CameraPreset) => void;
  onFit: () => void;
};

export function CameraPanel({ camera, reducedMotion, onChange, onFit }: CameraPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="studio-camera-title">
      <h2 id="studio-camera-title" className={styles.panelTitle}>
        Cámara
      </h2>
      <div className={styles.panelBody}>
        <div className={styles.row} role="group" aria-label="Vistas predefinidas">
          {(Object.keys(CAMERA_PRESET_LABELS) as CameraPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={camera === preset ? styles.chipBtnActive : styles.chipBtn}
              aria-pressed={camera === preset}
              onClick={() => onChange(preset)}
            >
              {CAMERA_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.chipBtn} onClick={onFit}>
          Encuadrar recinto
        </button>
        <p className={styles.hint}>
          Órbita: arrastra para rotar, rueda para acercar. {reducedMotion
            ? 'Movimiento reducido activo: sin auto-rotación ni fundidos.'
            : 'Las vistas cambian con una transición suave.'}
        </p>
      </div>
    </section>
  );
}
