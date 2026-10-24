'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import type { Density } from '../../styles/tokens';
import { useTicketDensity } from './BlackTicketRoot';
import styles from './TicketButton.module.scss';

/** Una primaria hueso. El resto no compite con ella. */
export type TicketButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface TicketButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Por defecto `primary`: relleno hueso, una por vista. */
  variant?: TicketButtonVariant;
  /** Alto 48 / 56 / 36. Si se omite, hereda el lienzo. */
  density?: Density;
  /** Ancho de la columna. En taquilla, Cobrar va así. */
  fullWidth?: boolean;
  children?: ReactNode;
}

/**
 * Botón del lenguaje visual. El primario es hueso, sin dorado.
 * Secundario, peligro y fantasma no usan ese relleno.
 */
export const TicketButton = forwardRef<HTMLButtonElement, TicketButtonProps>(function TicketButton(
  {
    variant = 'primary',
    density,
    fullWidth = false,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const resolved = useTicketDensity(density);

  return (
    <button
      ref={ref}
      type={type}
      data-density={resolved}
      className={cx(
        styles.button,
        styles[variant],
        styles[resolved],
        fullWidth && styles.fullWidth,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
