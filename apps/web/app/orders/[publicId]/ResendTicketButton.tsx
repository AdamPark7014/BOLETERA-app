'use client';

import { useState } from 'react';
import { TicketButton } from '@boletera/ui';
import { fetchOrderResource } from '@/lib/order-access';
import styles from './order.module.scss';

/**
 * «Reenviar boleto»: vuelve a mandar la confirmación y el PDF al correo de la
 * compra. Misma credencial que la lectura de la orden (token del enlace o
 * sesión). El API limita a 1 por minuto y 3 por hora por orden; su mensaje
 * (429) se pinta tal cual, no se traduce ni se esconde.
 */
export function ResendTicketButton({
  apiBase,
  publicId,
  accessToken,
}: {
  apiBase: string;
  publicId: string;
  accessToken?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function resend() {
    setBusy(true);
    setError('');
    setSentTo(null);
    const result = await fetchOrderResource<{ ok: boolean; sentTo?: string | null }>(
      apiBase,
      publicId,
      '/resend',
      accessToken,
      { method: 'POST' }
    );
    setBusy(false);
    if (result.ok) {
      setSentTo(result.data.sentTo ?? 'el correo de la compra');
      return;
    }
    setError(
      result.status === 429 || result.status === 409 || result.status === 0
        ? result.message
        : result.forbidden
          ? 'Abre la orden desde el enlace del correo o inicia sesión para reenviar el boleto.'
          : result.message || 'No pudimos reenviar el boleto. Inténtalo de nuevo.'
    );
  }

  return (
    <span className={styles.resend}>
      <TicketButton
        variant="secondary"
        type="button"
        onClick={() => void resend()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Reenviando…' : 'Reenviar boleto'}
      </TicketButton>
      {sentTo && (
        <span className={styles.copyHint} role="status" aria-live="polite">
          Lo reenviamos a {sentTo}. Puede tardar unos minutos; revisa también spam.
        </span>
      )}
      {error && (
        <span className={styles.resendError} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
