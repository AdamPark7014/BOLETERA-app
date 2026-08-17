'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { verifyManagerPin } from '@/lib/pos';
import styles from './Dialog.module.scss';

/**
 * Autorización de gerente.
 *
 * Puerta única para las operaciones sensibles (anulación, devolución, cortesía,
 * descuento, retiro de efectivo, corte con diferencia, traspaso). El PIN se
 * comprueba SIEMPRE contra `/taquilla/manager-pin/verify` — nunca en cliente —
 * y sólo se devuelve al llamante si el API lo dio por bueno.
 *
 * Es el ÚNICO diálogo de confirmación que se interpone en el camino del cajero:
 * la venta normal no tiene ninguno, porque cada diálogo son segundos por cada
 * persona de la fila.
 */
export function ManagerPinDialog({
  open,
  title,
  detail,
  confirmLabel = 'Autorizar',
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  /** Recibe el PIN ya validado por el API para reenviarlo en la operación. */
  onConfirm: (pin: string) => void | Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    setPin('');
    setError('');
    setBusy(false);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError('');
    const ok = await verifyManagerPin(pin);
    if (!ok) {
      setError('PIN incorrecto o sin autorización.');
      setPin('');
      setBusy(false);
      inputRef.current?.focus();
      return;
    }
    try {
      await onConfirm(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La operación falló');
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pin-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <form className={styles.dialog} onSubmit={(e) => void submit(e)}>
        <p className={styles.eyebrow}>Autorización de gerente</p>
        <h2 id="pin-title" className={styles.title}>
          {title}
        </h2>
        {detail && <p className={styles.lead}>{detail}</p>}

        <label className={styles.field}>
          <small>PIN de gerente</small>
          <input
            ref={inputRef}
            className={styles.pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            className={danger ? styles.danger : styles.primary}
            disabled={busy || pin.length < 4}
          >
            {busy ? 'Verificando…' : confirmLabel}
          </button>
        </div>
        <p className={styles.hint}>
          <kbd>Enter</kbd> autorizar · <kbd>Esc</kbd> cancelar
        </p>
      </form>
    </div>
  );
}
