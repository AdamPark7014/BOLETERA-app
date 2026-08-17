'use client';

import Link from 'next/link';
import { Button, SegmentedControl, Toolbar, ToolbarSeparator } from '@boletera/ui';
import type { CameraPreset, StudioColorMode, StudioQuality } from './types';
import { CAMERA_PRESET_LABELS, COLOR_MODE_LABELS } from './types';
import styles from './Venue3DStudio.module.scss';

type StudioToolbarProps = {
  studio: boolean;
  camera: CameraPreset;
  colorMode: StudioColorMode;
  quality: StudioQuality;
  canSave: boolean;
  saving: boolean;
  onCameraChange: (preset: CameraPreset) => void;
  onColorModeChange: (mode: StudioColorMode) => void;
  onQualityChange: (quality: StudioQuality) => void;
  onFit: () => void;
  onSave: () => void;
  mapHref: string;
};

export function StudioToolbar({
  studio,
  camera,
  colorMode,
  quality,
  canSave,
  saving,
  onCameraChange,
  onColorModeChange,
  onQualityChange,
  onFit,
  onSave,
  mapHref,
}: StudioToolbarProps) {
  return (
    <div className={styles.toolbarWrap}>
      <Toolbar
        label="Herramientas del estudio 3D"
        surface
        end={
          <div className={styles.toolbarActions}>
            <Button type="button" size="sm" variant="outline" onClick={onFit}>
              Encuadrar
            </Button>
            <Link href={mapHref} className={styles.chipBtn}>
              Vista planta
            </Link>
            {studio && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                loading={saving}
                loadingLabel="Guardando…"
                disabled={!canSave || saving}
                onClick={onSave}
              >
                Guardar mapa
              </Button>
            )}
          </div>
        }
      >
        <SegmentedControl
          label="Cámara"
          size="sm"
          value={camera}
          onValueChange={onCameraChange}
          options={(Object.keys(CAMERA_PRESET_LABELS) as CameraPreset[]).map((value) => ({
            value,
            label: CAMERA_PRESET_LABELS[value],
          }))}
        />
        <ToolbarSeparator />
        <SegmentedControl
          label="Coloreado"
          size="sm"
          value={colorMode}
          onValueChange={onColorModeChange}
          options={(Object.keys(COLOR_MODE_LABELS) as StudioColorMode[]).map((value) => ({
            value,
            label: COLOR_MODE_LABELS[value],
          }))}
        />
        <ToolbarSeparator />
        <SegmentedControl
          label="Calidad"
          size="sm"
          value={quality}
          onValueChange={onQualityChange}
          options={[
            { value: 'high', label: 'Alta' },
            { value: 'balanced', label: 'Equilibrada' },
            { value: 'low', label: 'Ligera' },
          ]}
        />
      </Toolbar>
      <p className={styles.hint}>
        Teclado: 1–5 coloreado · O órbita · P planta · L lateral · E escenario · V desde asiento · F
        encuadrar · ←/→ asiento · Esc limpiar
      </p>
    </div>
  );
}
