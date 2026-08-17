'use client';

import { useMemo, useState } from 'react';
import { GLOBAL_HOTKEYS, useHotkeys, type Hotkey } from '@/lib/hotkeys';
import styles from './HotkeyBar.module.scss';

/**
 * Barra de atajos siempre visible.
 *
 * El taquillero nuevo aprende viendo: si el atajo no está pintado, no se usa.
 * `?` abre la hoja completa con TODOS los atajos de la app.
 */
export function HotkeyBar({ hotkeys, enabled = true }: { hotkeys: Hotkey[]; enabled?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const visible = hotkeys.filter((h) => !h.hidden);

  useHotkeys(
    [
      {
        keys: '?',
        label: 'Atajos',
        match: (e) => e.key === '?' || (e.key === '/' && e.shiftKey),
        run: () => setHelpOpen((v) => !v),
      },
      {
        keys: 'Esc',
        label: 'Cerrar',
        whileTyping: true,
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
        <span className={styles.title}>Atajos</span>
        {visible.map((hk) => (
          <span key={`${hk.keys}-${hk.label}`} className={styles.item}>
            <kbd>{hk.keys}</kbd>
            {hk.label}
          </span>
        ))}
        <span className={styles.help}>
          <kbd>?</kbd> ver todos
        </span>
      </nav>

      {helpOpen && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="Todos los atajos"
          onClick={() => setHelpOpen(false)}
        >
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <h2>Atajos de teclado</h2>
            <p>Toda la operación de ventanilla se puede hacer sin ratón.</p>
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
            <button type="button" className={styles.close} onClick={() => setHelpOpen(false)}>
              Cerrar · Esc
            </button>
          </div>
        </div>
      )}
    </>
  );
}
