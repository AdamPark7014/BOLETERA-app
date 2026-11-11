'use client';

import { useState, type FormEvent } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { fetchOrderResource } from '@/lib/order-access';
import { formatShortDate } from '@/lib/refund-policy';
import { clabeError, groupClabe, normalizeClabe } from './clabe';
import styles from './order.module.scss';

/** Lo que el API devuelve de la cuenta ya capturada (CLABE enmascarada). */
export type RefundPayout = {
  id: string;
  payoutClabe?: string | null;
  payoutAccountHolder?: string | null;
  payoutClabeAt?: string | null;
};

/**
 * CLABE y titular para un reembolso que no vuelve a tarjeta.
 *
 * Valida en el navegador con el mismo algoritmo de Banxico que el API para
 * avisar del error antes de enviar; el servidor vuelve a validar y sus errores
 * (orden ajena, reembolso ya cerrado, pago con tarjeta) se pintan tal cual.
 */
export function RefundClabeForm({
  apiBase,
  publicId,
  accessToken,
  refund,
  onSaved,
  primary = true,
}: {
  apiBase: string;
  publicId: string;
  accessToken?: string | null;
  refund: RefundPayout;
  onSaved?: () => void;
  /** Falso si la vista ya tiene su primario (p. ej. «Descargar PDF»). */
  primary?: boolean;
}) {
  const registered = Boolean(refund.payoutClabe);
  const [editing, setEditing] = useState(!registered);
  const [clabe, setClabe] = useState('');
  const [holder, setHolder] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [saved, setSaved] = useState<RefundPayout | null>(null);

  const current = saved ?? refund;
  const localError = clabeError(clabe);
  const holderError =
    holder.trim().length < 3 ? 'Escribe el nombre del titular de la cuenta.' : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    setServerError('');
    if (localError || holderError) return;
    setBusy(true);
    const result = await fetchOrderResource<{
      refundId: string;
      payoutClabe: string | null;
      payoutAccountHolder: string | null;
      payoutClabeAt: string | null;
    }>(apiBase, publicId, `/refunds/${encodeURIComponent(refund.id)}/clabe`, accessToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clabe: normalizeClabe(clabe), accountHolder: holder.trim() }),
    });
    setBusy(false);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    setSaved({
      id: result.data.refundId,
      payoutClabe: result.data.payoutClabe,
      payoutAccountHolder: result.data.payoutAccountHolder,
      payoutClabeAt: result.data.payoutClabeAt,
    });
    setEditing(false);
    setClabe('');
    setHolder('');
    setTouched(false);
    onSaved?.();
  }

  if (!editing && current.payoutClabe) {
    return (
      <div className={styles.bankAccountNote}>
        <h3>Cuenta para tu reembolso</h3>
        <ul className={styles.refundRows}>
          <li>
            <span>CLABE</span>
            <strong className={styles.monoValue}>{current.payoutClabe}</strong>
          </li>
          {current.payoutAccountHolder && (
            <li>
              <span>Titular</span>
              <strong>{current.payoutAccountHolder}</strong>
            </li>
          )}
          {current.payoutClabeAt && (
            <li>
              <span>Registrada</span>
              <strong>{formatShortDate(current.payoutClabeAt)}</strong>
            </li>
          )}
        </ul>
        <p className={styles.refundNote}>
          {saved ? 'Listo, la guardamos. ' : ''}
          Mientras el reembolso siga pendiente puedes cambiarla.
        </p>
        <div className={styles.actions}>
          <TicketButton variant="ghost" type="button" onClick={() => setEditing(true)}>
            Cambiar cuenta
          </TicketButton>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.bankAccountNote} onSubmit={(e) => void submit(e)} noValidate>
      <h3>Necesitamos tu CLABE</h3>
      <p>
        Tu pago no fue con tarjeta, así que te devolvemos por transferencia SPEI. Escribe la CLABE
        interbancaria (18 dígitos) y el nombre del titular. El plazo empieza a contar desde que la
        recibimos.
      </p>
      <div className={styles.clabeFields}>
        <Field
          label="CLABE interbancaria"
          hint={clabe ? groupClabe(clabe) : '18 dígitos, en tu app bancaria'}
          inputMode="numeric"
          autoComplete="off"
          maxLength={24}
          value={clabe}
          onChange={(e) => setClabe(e.target.value)}
          onBlur={() => clabe && setTouched(true)}
          error={touched && localError ? localError : undefined}
        />
        <Field
          label="Titular de la cuenta"
          autoComplete="name"
          maxLength={120}
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          error={touched && holderError ? holderError : undefined}
        />
      </div>
      {serverError && (
        <p className={styles.resendError} role="alert">
          {serverError}
        </p>
      )}
      <div className={styles.actions}>
        <TicketButton
          type="submit"
          variant={primary ? 'primary' : 'secondary'}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Guardando…' : 'Guardar CLABE'}
        </TicketButton>
        {registered && (
          <TicketButton variant="ghost" type="button" onClick={() => setEditing(false)}>
            Cancelar
          </TicketButton>
        )}
      </div>
    </form>
  );
}
