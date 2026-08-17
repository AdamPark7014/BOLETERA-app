'use client';

import type { StageDraft } from '../types';
import styles from '../Venue3DStudio.module.scss';

type StagePanelProps = {
  stage: StageDraft;
  disabled?: boolean;
  onChange: (next: StageDraft) => void;
  onReset: () => void;
};

export function StagePanel({ stage, disabled, onChange, onReset }: StagePanelProps) {
  function patch<K extends keyof StageDraft>(key: K, value: StageDraft[K]) {
    onChange({ ...stage, [key]: value });
  }

  return (
    <section className={styles.panel} aria-labelledby="studio-stage-title">
      <h2 id="studio-stage-title" className={styles.panelTitle}>
        Escenario
      </h2>
      <div className={styles.panelBody}>
        <p className={styles.hint}>
          Ajusta posición y tamaño para recalcular la visibilidad y las zonas obstruidas.
        </p>
        {(
          [
            ['x', 'Posición X', -2000, 2000, 1],
            ['y', 'Posición Y', -2000, 2000, 1],
            ['width', 'Ancho', 20, 2000, 1],
            ['rotation', 'Rotación (°)', -180, 180, 1],
            ['elevation', 'Elevación', 0, 400, 1],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <div key={key} className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`stage-${key}`}>
              {label}
            </label>
            <input
              id={`stage-${key}`}
              className={styles.fieldInput}
              type="number"
              min={min}
              max={max}
              step={step}
              value={stage[key]}
              disabled={disabled}
              onChange={(event) => patch(key, Number(event.target.value))}
            />
          </div>
        ))}
        <button type="button" className={styles.chipBtn} disabled={disabled} onClick={onReset}>
          Restaurar escenario del mapa
        </button>
      </div>
    </section>
  );
}
