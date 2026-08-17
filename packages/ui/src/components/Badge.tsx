import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Badge.module.scss';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeVariant = 'soft' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color semantico. Por defecto `neutral`. */
  tone?: BadgeTone;
  /** Tratamiento de relleno. Por defecto `soft`. */
  variant?: BadgeVariant;
  /** Densidad. Por defecto `sm`. */
  size?: BadgeSize;
  /** Antepone un punto del color del tono (estados de entidad). */
  dot?: boolean;
  /** Icono decorativo a la izquierda. */
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Etiqueta compacta para estados y categorias.
 * Es puramente visual: si el estado no aparece en otro lugar del DOM, pasa el
 * texto completo como `children` en vez de depender solo del color.
 */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'sm',
  dot = false,
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(styles.badge, styles[tone], styles[variant], styles[size], className)}
      {...rest}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
