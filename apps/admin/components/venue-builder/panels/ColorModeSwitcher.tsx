'use client';

import { memo } from 'react';
import type { ColorMode } from '@boletera/venue-engine/render';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import styles from '../VenueBuilder.module.scss';

const MODES: Array<{ id: ColorMode; label: string; shortcut: string }> = [
  { id: 'zone', label: 'Zona', shortcut: '1' },
  { id: 'tier', label: 'Tier', shortcut: '2' },
  { id: 'price', label: 'Precio', shortcut: '3' },
  { id: 'status', label: 'Estado', shortcut: '4' },
  { id: 'sightline', label: 'Visión', shortcut: '5' },
];

export const ColorModeSwitcher = memo(function ColorModeSwitcher() {
  const { editor } = useVenueBuilderStores();
  const colorMode = useEditor((state) => state.colorMode);

  return (
    <div className={styles.toolGroup} role="group" aria-label="Modo de color">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={mode.id === colorMode ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => editor.getState().setColorMode(mode.id)}
          title={`${mode.label} (${mode.shortcut})`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
});
