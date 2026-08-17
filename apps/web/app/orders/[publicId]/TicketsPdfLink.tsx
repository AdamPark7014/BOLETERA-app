'use client';

import { useState } from 'react';
import { authHeaders, getToken } from '@/lib/auth';
import { orderApiUrl } from '@/lib/order-access';
import styles from './order.module.scss';

/**
 * Descarga del PDF de boletos.
 *
 * Dos caminos, porque las dos credenciales no viajan igual:
 *
 *   · Con `accessToken` basta un `<a href>` con el token en el querystring.
 *     Es lo que hay que usar siempre que se pueda: el navegador gestiona la
 *     descarga, funciona en iOS y sobrevive a pestañas nuevas.
 *   · Sin token pero con sesión iniciada, la credencial es la cabecera
 *     `Authorization`, y un `<a href>` no manda cabeceras. Ahí se pide por
 *     `fetch` y se entrega el blob. Sin esto, el comprador con sesión veía un
 *     403 al pulsar «Descargar PDF».
 */
export function TicketsPdfLink({
  apiBase,
  publicId,
  accessToken,
}: {
  apiBase: string;
  publicId: string;
  accessToken?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (accessToken) {
    return (
      <a className={styles.pdfLink} href={orderApiUrl(apiBase, publicId, '/tickets.pdf', accessToken)}>
        Descargar PDF
      </a>
    );
  }

  async function download() {
    setBusy(true);
    setError('');
    let objectUrl: string | null = null;
    try {
      const res = await fetch(orderApiUrl(apiBase, publicId, '/tickets.pdf'), {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? 'Abre la orden desde el enlace del correo para descargar el PDF.'
            : 'No pudimos generar el PDF. Inténtalo de nuevo.',
        );
        return;
      }
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `boletera-${publicId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexión.');
    } finally {
      // Revocar de inmediato aborta la descarga en algunos navegadores.
      const created = objectUrl;
      if (created) setTimeout(() => URL.revokeObjectURL(created), 60_000);
      setBusy(false);
    }
  }

  if (!getToken()) return null;

  return (
    <span>
      <button
        type="button"
        className={styles.pdfLink}
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Generando PDF…' : 'Descargar PDF'}
      </button>
      {error && (
        <span className={styles.copyHint} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
