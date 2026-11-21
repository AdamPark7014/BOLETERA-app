'use client';

import type { PosReceipt } from '@/lib/pos';
import { printBrowserReceipt } from '@/lib/pos';
import { labelPaymentParts } from '@/lib/cash';
import { formatTicketAmount, formatDateTime } from '@boletera/ui';
import styles from './PrintableReceipt.module.scss';

type Props = {
  receipt: PosReceipt;
  onClose?: () => void;
};

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  COMP: 'Cortesía',
  MIXED: 'Mixto',
};

function paymentLabel(receipt: PosReceipt): string {
  if (receipt.paymentParts?.length) {
    return `Mixto · ${labelPaymentParts(receipt.paymentParts)}`;
  }
  return METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod;
}

export function PrintableReceipt({ receipt, onClose }: Props) {
  return (
    <>
      <div id="bt-receipt-print" className={styles.printRoot} aria-hidden="true" />
      <div className={styles.panel} role="status">
        <div className={styles.folio}>{receipt.receiptNumber}</div>
        <div className={styles.meta}>{formatDateTime(receipt.timestamp)}</div>
        <div className={styles.event}>{receipt.eventName}</div>

        <div className={styles.line}>
          <span>Boletos</span>
          <span>{receipt.quantity}</span>
        </div>
        <div className={styles.line}>
          <span>Subtotal</span>
          <span>{formatTicketAmount(receipt.subtotal)}</span>
        </div>
        {receipt.fees > 0 ? (
          <div className={styles.line}>
            <span>Cargos</span>
            <span>{formatTicketAmount(receipt.fees)}</span>
          </div>
        ) : null}
        {receipt.taxes > 0 ? (
          <div className={styles.line}>
            <span>IVA</span>
            <span>{formatTicketAmount(receipt.taxes)}</span>
          </div>
        ) : null}
        <div className={styles.total}>
          <span>Total</span>
          <strong>{formatTicketAmount(receipt.total)}</strong>
        </div>

        <div className={styles.line}>
          <span>Pago</span>
          <span>{paymentLabel(receipt)}</span>
        </div>
        {receipt.cashReceived != null ? (
          <>
            <div className={styles.line}>
              <span>Recibido</span>
              <span>{formatTicketAmount(receipt.cashReceived)}</span>
            </div>
            <div className={styles.line}>
              <span>Cambio</span>
              <span>{formatTicketAmount(receipt.changeGiven ?? 0)}</span>
            </div>
          </>
        ) : null}

        {receipt.ticketCodes?.length ? (
          <ul className={styles.tickets}>
            {receipt.ticketCodes.map((t) => (
              <li key={t.barcode}>
                {t.seatInfo} · {t.barcode}
              </li>
            ))}
          </ul>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.printBtn}
            onClick={() => printBrowserReceipt(receipt)}
          >
            Imprimir
          </button>
          {onClose ? (
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Nueva venta
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
