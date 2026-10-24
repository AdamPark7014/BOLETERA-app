'use client';

import { useId, useState } from 'react';
import { cx } from '../../lib/cx';
import { formatTicketAmount } from '../../lib/format';
import styles from './Money.module.scss';

/** Neutro no lleva tinte. Entrada y salida pintan el número y un filete. */
export type MoneyDirection = 'neutral' | 'in' | 'out';

export interface MoneyLine {
  label: string;
  amount: number;
}

export interface MoneyProps {
  /** «Total», «A cobrar». Va en caption. */
  label: string;
  amount: number;
  /** «MXN» solo en el total, no en cada renglón. */
  currency?: boolean;
  /** Filete y color del número cuando el movimiento ya ocurrió. */
  direction?: MoneyDirection;
  /** Precio, cargo, descuento. Empieza cerrado. El total no se esconde. */
  lines?: MoneyLine[];
  defaultOpen?: boolean;
  className?: string;
}

/** Bloque de total. El descuento se lee en hueso, con el menos tipográfico. */
export function Money({
  label,
  amount,
  currency = false,
  direction = 'neutral',
  lines,
  defaultOpen = false,
  className,
}: MoneyProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const hasLines = Boolean(lines && lines.length > 0);

  return (
    <div
      className={cx(
        styles.block,
        direction === 'in' && styles.in,
        direction === 'out' && styles.out,
        className,
      )}
    >
      <div className={styles.head}>
        <p className={styles.label}>{label}</p>
        {currency ? <p className={styles.currency}>MXN</p> : null}
      </div>
      <p className={styles.figure}>{formatTicketAmount(amount)}</p>
      {hasLines ? (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Ocultar desglose' : 'Ver desglose'}
          </button>
          <div id={panelId} className={cx(styles.panel, open && styles.open)} inert={!open}>
            <div className={styles.panelInner}>
              <ul className={styles.lines}>
                {lines?.map((line) => (
                  <li key={line.label} className={styles.line}>
                    <span>{line.label}</span>
                    <span className={styles.amount}>{formatTicketAmount(line.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
