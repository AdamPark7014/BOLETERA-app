'use client';

import { memo } from 'react';
import { SHORTCUT_GROUPS } from '../hooks/shortcuts';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import styles from '../VenueBuilder.module.scss';

export const ShortcutsOverlay = memo(function ShortcutsOverlay() {
  const open = useEditor((state) => state.shortcutsOpen);
  const { editor } = useVenueBuilderStores();

  if (!open) return null;

  return (
    <div
      className={styles.shortcutsBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado"
      onClick={() => editor.getState().setShortcutsOpen(false)}
    >
      <div className={styles.shortcutsCard} onClick={(event) => event.stopPropagation()}>
        <header className={styles.shortcutsHeader}>
          <h2>Atajos de teclado</h2>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Cerrar"
            onClick={() => editor.getState().setShortcutsOpen(false)}
          >
            ✕
          </button>
        </header>
        <div className={styles.shortcutsGrid}>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.entries.map((entry) => (
                  <li key={`${group.title}-${entry.keys}`}>
                    <kbd>{entry.keys}</kbd>
                    <span>{entry.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
});
