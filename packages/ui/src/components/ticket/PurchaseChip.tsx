import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './PurchaseChip.module.scss';

export type PurchaseChipTone = 'neutral' | 'accent' | 'warn';

export interface PurchaseChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  children: ReactNode;
  /** `accent` usa el dorado Black Ticket; no sustituye el botón primario. */
  tone?: PurchaseChipTone;
}

/** Chip de estado para la compra web (no altera admin ni taquilla). */
export function PurchaseChip({
  children,
  tone = 'neutral',
  className,
  ...rest
}: PurchaseChipProps) {
  return (
    <span className={cx(styles.chip, styles[tone], className)} {...rest}>
      {children}
    </span>
  );
}
