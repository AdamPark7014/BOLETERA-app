import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import styles from './Spinner.module.scss';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Diametro del indicador. Por defecto `sm`. */
  size?: SpinnerSize;
  /**
   * Texto anunciado por lectores de pantalla. Si se omite, el spinner se marca
   * como decorativo (el estado ya lo comunica el contenedor, p. ej. un boton).
   */
  label?: string;
}

/** Indicador de carga indeterminado. Se detiene con `prefers-reduced-motion`. */
export function Spinner({ size = 'sm', label, className, ...rest }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, styles[size], className)}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <circle className={styles.track} cx="12" cy="12" r="9" />
        <circle className={styles.head} cx="12" cy="12" r="9" />
      </svg>
      {label ? <span className={styles.srOnly}>{label}</span> : null}
    </span>
  );
}
