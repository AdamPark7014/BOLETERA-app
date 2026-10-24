import { cx } from '../../lib/cx';
import styles from './NamedStatus.module.scss';

const STATUS = {
  libre: { label: 'Libre', dot: null },
  apartado: { label: 'Apartado', dot: 'gold' },
  vendido: { label: 'Vendido', dot: 'sold' },
  bloqueado: { label: 'Bloqueado', dot: 'hatch' },
  accesible: { label: 'Accesible', dot: 'steel' },
  pendiente: { label: 'Pendiente', dot: null },
  cobrado: { label: 'Cobrado', dot: 'sage' },
  reembolsado: { label: 'Reembolsado', dot: 'clay' },
  cuadrado: { label: 'Cuadrado', dot: null },
  descuadrado: { label: 'Descuadrado', dot: 'clay' },
} as const;

export type NamedStatusName = keyof typeof STATUS;

const DOT_CLASS = {
  gold: styles.gold,
  sold: styles.sold,
  hatch: styles.hatch,
  steel: styles.steel,
  sage: styles.sage,
  clay: styles.clay,
} as const;

export interface NamedStatusProps {
  status: NamedStatusName;
  className?: string;
}

/** Estado con nombre. El punto acompaña; el chip no se rellena del color. */
export function NamedStatus({ status, className }: NamedStatusProps) {
  const item = STATUS[status];

  return (
    <span className={cx(styles.chip, className)}>
      {item.dot ? (
        <span className={cx(styles.dot, DOT_CLASS[item.dot])} aria-hidden="true" />
      ) : null}
      {item.label}
    </span>
  );
}
