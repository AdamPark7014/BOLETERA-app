'use client';

import { changeBreakdownLabel, mixedCashState, splitMixedPayment } from '@/lib/cash';
import { formatTicketAmount } from '@boletera/ui';
import styles from '../app/venta/venta.module.scss';

/** True cuando ambas partes suman el total y el efectivo recibido cubre la parte en efectivo. */
export function canChargeMixed(due: number, cashPart: string, cashReceived: string): boolean {
  const split = splitMixedPayment(due, cashPart);
  if (!split.valid || split.cashPart <= 0 || split.cardPart <= 0) return false;
  return mixedCashState(split.cashPart, cashReceived).sufficient;
}

type Props = {
  due: number;
  cashPart: string;
  onCashPartChange: (v: string) => void;
  cashReceived: string;
  onCashReceivedChange: (v: string) => void;
};

export function MixedTenderPanel({
  due,
  cashPart,
  onCashPartChange,
  cashReceived,
  onCashReceivedChange,
}: Props) {
  const split = splitMixedPayment(due, cashPart);
  const cash = mixedCashState(split.cashPart, cashReceived);

  return (
    <>
      <div className={styles.cashRow}>
        <label className={styles.cashBox}>
          <span>En efectivo</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="$0"
            value={cashPart}
            onChange={(e) => onCashPartChange(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </label>
        <div className={styles.changeBox}>
          <span>Con tarjeta</span>
          <strong>{formatTicketAmount(split.valid ? split.cardPart : 0)}</strong>
        </div>
      </div>

      {!split.valid && split.error ? (
        <div className={styles.statusBox} role="alert">
          <strong>{split.error}</strong>
        </div>
      ) : null}

      {split.valid && split.cashPart > 0 ? (
        <div className={styles.cashRow}>
          <label className={styles.cashBox}>
            <span>Recibido</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="$0"
              value={cashReceived}
              onChange={(e) => onCashReceivedChange(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </label>
          <div
            className={cash.sufficient ? styles.changeBox : styles.missingBox}
            title={
              cash.sufficient && cash.change > 0 ? changeBreakdownLabel(cash.change) : undefined
            }
          >
            <span>{cash.sufficient ? 'Cambio' : 'Faltan'}</span>
            <strong>{formatTicketAmount(cash.sufficient ? cash.change : cash.missing)}</strong>
          </div>
        </div>
      ) : null}

      {split.valid && split.cashPart > 0 && split.cardPart > 0 ? (
        <div className={styles.statusBox} role="status">
          <strong>Pago mixto</strong>
          <span>
            Efectivo {formatTicketAmount(split.cashPart)} · Tarjeta{' '}
            {formatTicketAmount(split.cardPart)}. Pasa la tarjeta por la parte con terminal.
          </span>
        </div>
      ) : null}
    </>
  );
}
