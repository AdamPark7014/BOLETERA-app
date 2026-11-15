import type { ReactNode } from 'react';
import styles from './Kbd.module.scss';

/**
 * Atajo de teclado discreto. Se oculta por debajo de 1024 px (no hay teclado
 * físico) y es `aria-hidden`: la etiqueta del control ya dice qué hace; la
 * hoja de atajos («?») los lista todos.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={[styles.kbd, className].filter(Boolean).join(' ')} aria-hidden="true">
      {children}
    </kbd>
  );
}
