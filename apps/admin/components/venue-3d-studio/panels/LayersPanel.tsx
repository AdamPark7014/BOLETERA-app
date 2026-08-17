'use client';

import type { LayerVisibility } from '../types';
import styles from '../Venue3DStudio.module.scss';

type LayersPanelProps = {
  levels: Array<{ id: string; name: string }>;
  levelFilter: string | 'ALL';
  layers: LayerVisibility;
  onLevelFilterChange: (levelId: string | 'ALL') => void;
  onLayersChange: (next: LayerVisibility) => void;
};

export function LayersPanel({
  levels,
  levelFilter,
  layers,
  onLevelFilterChange,
  onLayersChange,
}: LayersPanelProps) {
  function setOpacity(key: keyof LayerVisibility['opacity'], value: number) {
    onLayersChange({
      ...layers,
      opacity: { ...layers.opacity, [key]: value },
    });
  }

  function setFlag(key: Exclude<keyof LayerVisibility, 'levels' | 'opacity'>, value: boolean) {
    onLayersChange({ ...layers, [key]: value });
  }

  function setLevelVisible(id: string, visible: boolean) {
    onLayersChange({
      ...layers,
      levels: { ...layers.levels, [id]: visible },
    });
  }

  return (
    <section className={styles.panel} aria-labelledby="studio-layers-title">
      <h2 id="studio-layers-title" className={styles.panelTitle}>
        Capas y niveles
      </h2>
      <div className={styles.panelBody}>
        <div className={styles.row} role="toolbar" aria-label="Filtro de nivel">
          <button
            type="button"
            className={levelFilter === 'ALL' ? styles.chipBtnActive : styles.chipBtn}
            onClick={() => onLevelFilterChange('ALL')}
          >
            Todos
          </button>
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              className={levelFilter === level.id ? styles.chipBtnActive : styles.chipBtn}
              onClick={() => onLevelFilterChange(level.id)}
            >
              {level.name}
            </button>
          ))}
        </div>

        {levels.length > 0 && (
          <div className={styles.panelBody}>
            {levels.map((level) => (
              <div key={level.id} className={styles.toggleRow}>
                <label>
                  <input
                    type="checkbox"
                    checked={layers.levels[level.id] !== false}
                    onChange={(event) => setLevelVisible(level.id, event.target.checked)}
                  />
                  {level.name}
                </label>
              </div>
            ))}
          </div>
        )}

        {(
          [
            ['sections', 'Secciones'],
            ['furniture', 'Mobiliario'],
            ['structure', 'Estructura / salidas'],
            ['aisles', 'Pasillos'],
            ['obstacles', 'Obstáculos'],
            ['exits', 'Salidas'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className={styles.toggleRow}>
            <label>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(event) => setFlag(key, event.target.checked)}
              />
              {label}
            </label>
          </div>
        ))}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="opacity-seats">
            Opacidad asientos ({Math.round(layers.opacity.seats * 100)}%)
          </label>
          <input
            id="opacity-seats"
            className={styles.fieldRange}
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={layers.opacity.seats}
            onChange={(event) => setOpacity('seats', Number(event.target.value))}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="opacity-furniture">
            Opacidad mobiliario ({Math.round(layers.opacity.furniture * 100)}%)
          </label>
          <input
            id="opacity-furniture"
            className={styles.fieldRange}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layers.opacity.furniture}
            onChange={(event) => setOpacity('furniture', Number(event.target.value))}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="opacity-structure">
            Opacidad estructura ({Math.round(layers.opacity.structure * 100)}%)
          </label>
          <input
            id="opacity-structure"
            className={styles.fieldRange}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layers.opacity.structure}
            onChange={(event) => setOpacity('structure', Number(event.target.value))}
          />
        </div>
        <p className={styles.hint}>
          Mostrar/ocultar se aplica al instante. La opacidad parcial de mallas requiere soporte en
          Venue3DViewer.
        </p>
      </div>
    </section>
  );
}
