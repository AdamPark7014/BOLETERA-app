'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Spinner } from './Spinner';
import styles from './Button.module.scss';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Jerarquia visual del boton. Por defecto `primary`. */
  variant?: ButtonVariant;
  /** Altura y densidad. Por defecto `md`. */
  size?: ButtonSize;
  /** Muestra un spinner, bloquea el click y expone `aria-busy`. */
  loading?: boolean;
  /** Texto que sustituye al contenido mientras `loading` esta activo. */
  loadingLabel?: string;
  /** Adorno a la izquierda del texto. Se marca como decorativo. */
  iconLeft?: ReactNode;
  /** Adorno a la derecha del texto. Se marca como decorativo. */
  iconRight?: ReactNode;
  /** Ocupa todo el ancho disponible. */
  fullWidth?: boolean;
  /** Boton cuadrado sin texto. Exige `aria-label`. */
  iconOnly?: boolean;
  children?: ReactNode;
}

/**
 * Boton base del sistema. Cubre los seis niveles de jerarquia que usan los
 * paneles de admin y taquilla, con estado de carga accesible.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    iconLeft,
    iconRight,
    fullWidth = false,
    iconOnly = false,
    disabled = false,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        iconOnly && styles.iconOnly,
        loading && styles.loading,
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'xs'} /> : null}
      {!loading && iconLeft ? (
        <span className={styles.icon} aria-hidden="true">
          {iconLeft}
        </span>
      ) : null}
      {loading && loadingLabel ? (
        <span className={styles.label}>{loadingLabel}</span>
      ) : iconOnly ? null : (
        <span className={styles.label}>{children}</span>
      )}
      {!loading && iconRight ? (
        <span className={styles.icon} aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
      {iconOnly && !loading ? (
        <span className={styles.icon} aria-hidden="true">
          {children}
        </span>
      ) : null}
    </button>
  );
});
