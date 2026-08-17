import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Toolbar.module.scss';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Controles alineados al inicio. */
  children: ReactNode;
  /** Controles alineados al final, separados por espacio flexible. */
  end?: ReactNode;
  /** Etiqueta accesible de la barra. */
  label?: string;
  /** Anade fondo y borde propios (barra flotante sobre una tabla). */
  surface?: boolean;
  /** Fija la barra al hacer scroll. Requiere un ancestro con altura definida. */
  sticky?: boolean;
}

/**
 * Contenedor horizontal de controles con el rol `toolbar`. Envuelve en varias
 * lineas cuando no cabe, sin romper el orden de tabulacion.
 */
export function Toolbar({
  children,
  end,
  label = 'Acciones',
  surface = false,
  sticky = false,
  className,
  ...rest
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={cx(styles.toolbar, surface && styles.surface, sticky && styles.sticky, className)}
      {...rest}
    >
      <div className={styles.group}>{children}</div>
      {end ? <div className={styles.group}>{end}</div> : null}
    </div>
  );
}

/** Separador vertical entre grupos de controles de una {@link Toolbar}. */
export function ToolbarSeparator({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      className={cx(styles.separator, className)}
      {...rest}
    />
  );
}
