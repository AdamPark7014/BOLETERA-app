'use client';

import { useMemo, useState } from 'react';
import { GLOBAL_HOTKEYS, useHotkeys, type Hotkey } from '@/lib/hotkeys';
import styles from './HotkeyBar.module.scss';

/**
 * Leyenda fija al pie. `?` abre la hoja de la vista.
 */
export function HotkeyBar({ hotkeys, enabled = true }: { hotkeys: Hotkey[]; enabled?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const visible = hotkeys.filter((h) => !h.hidden).slice(0, 6);

  useHotkeys(
    [
      {
        keys: '?',
        label: 'Leyenda',
        match: (e) => e.key === '?' || (e.key === '/' && e.shiftKey),
        run: () => setHelpOpen((v) => !v),
      },
      {
        keys: 'Esc',
        label: 'Cerrar',
        whileTyping: true,
        hidden: true,
        match: (e) => e.key === 'Escape' && helpOpen,
        run: () => setHelpOpen(false),
      },
    ],
    enabled,
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof GLOBAL_HOTKEYS>();
    for (const hk of GLOBAL_HOTKEYS) {
      const list = map.get(hk.scope) ?? [];
      list.push(hk);
      map.set(hk.scope, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <>
      <nav className={styles.bar} aria-label="Atajos de teclado">
        {visible.map((hk) => (
          <span key={`${hk.keys}-${hk.label}`} className={styles.item}>
            <kbd>{hk.keys}</kbd>
            {hk.label}
          </span>
        ))}
        <span className={styles.help}>
          <kbd>?</kbd>
          leyenda
        </span>
      </nav>

      {helpOpen ? (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="Leyenda de atajos"
          onClick={() => setHelpOpen(false)}
        >
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <h2>Leyenda</h2>
            {groups.map(([scope, items]) => (
              <section key={scope} className={styles.group}>
                <h3>{scope}</h3>
                <ul className={styles.grid}>
                  {items.map((hk) => (
                    <li key={`${scope}-${hk.keys}-${hk.label}`}>
                      <kbd>{hk.keys}</kbd>
                      {hk.label}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
