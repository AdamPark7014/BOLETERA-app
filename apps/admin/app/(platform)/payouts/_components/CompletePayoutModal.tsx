'use client';

import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal } from '@boletera/ui';
import { formatMoney } from '../_lib/money';
import { formatDateTime, formatDay } from '../_lib/period';
import type { PayoutRow } from '../_lib/types';
import styles from '../payouts.module.scss';

type CompletePayoutModalProps = {
  payout: PayoutRow | null;
  busy: boolean;
  onConfirm: (referenceId: string) => void;
  onClose: () => void;
};

/**
 * Confirmación irreversible: marcar pagado exige la referencia SPEI real.
 * Vaciar el campo deshabilita el botón de confirmación.
 */
export function CompletePayoutModal({
  payout,
  busy,
  onConfirm,
  onClose,
}: CompletePayoutModalProps) {
  const formId = useId();
  const [referenceId, setReferenceId] = useState('');
  const trimmed = referenceId.trim();
  const open = payout !== null;

  useEffect(() => {
    setReferenceId(payout?.referenceId ?? '');
  }, [payout?.id, payout?.referenceId]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Marcar liquidación como pagada"
      description="Solo confirma cuando el SPEI haya sido ejecutado. Esta acción no se puede deshacer desde el panel."
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            form={formId}
            type="submit"
            disabled={!trimmed}
          >
            Confirmar pago
          </Button>
        </>
      }
    >
      {payout && (
        <form
          id={formId}
          className={styles.completeForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || busy) return;
            onConfirm(trimmed);
          }}
        >
          <dl className={styles.metaList}>
            <div>
              <dt>Periodo</dt>
              <dd>
                {formatDay(payout.periodStart)} – {formatDay(payout.periodEnd)}
              </dd>
            </div>
            <div>
              <dt>Neto a transferir</dt>
              <dd className={styles.amount}>{formatMoney(payout.netCents)}</dd>
            </div>
            <div>
              <dt>Estado actual</dt>
              <dd>{payout.status}</dd>
            </div>
            {payout.processedAt && (
              <div>
                <dt>Último movimiento</dt>
                <dd>{formatDateTime(payout.processedAt)}</dd>
              </div>
            )}
          </dl>

          <Input
            label="Referencia SPEI / transferencia"
            name="referenceId"
            value={referenceId}
            onChange={(event) => setReferenceId(event.target.value)}
            placeholder="Ej. SPEI-20260730-00421"
            autoComplete="off"
            requiredMark
            hint="Copia la clave de rastreo del banco. Quedará auditable en el historial."
            disabled={busy}
          />
        </form>
      )}
    </Modal>
  );
}
