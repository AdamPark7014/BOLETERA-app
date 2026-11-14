'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketButton } from '@boletera/ui';
import { networkError, readApiError } from '@/lib/api-errors';
import { authHeaders } from '@/lib/auth';
import { orderApiUrl, orderPath, readStoredOrderAccessToken } from '@/lib/order-access';
import styles from './SimulateDemoPaymentButton.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

/**
 * Control solo-demo: completa una orden SPEI/OXXO pendiente vía
 * `POST /orders/:publicId/demo-confirm`, la ruta del comprador (solo existe con
 * Banorte en demo). Acredita como la lectura de la orden: JWT de la sesión o el
 * `accessToken` del enlace. `/payments/confirm` es de administración y
 * respondía 401 al comprador.
 *
 * `orderId` se conserva por compatibilidad con los llamadores; ya no hace falta.
 */
export function SimulateDemoPaymentButton({
  publicId,
  accessToken,
  className,
}: {
  orderId?: string;
  publicId: string;
  accessToken?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const token = accessToken ?? readStoredOrderAccessToken(publicId);

  async function simulate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(orderApiUrl(API, publicId, '/demo-confirm', token), {
        method: 'POST',
        headers: { ...authHeaders() },
        cache: 'no-store',
      });
      if (!res.ok) {
        const info = await readApiError(res, 'No se pudo simular el acreditamiento');
        setError(info.message);
        return;
      }
      router.replace(orderPath(publicId, token));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : networkError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <TicketButton
        type="button"
        variant="secondary"
        onClick={() => void simulate()}
        disabled={busy || !publicId}
        aria-busy={busy}
      >
        {busy ? 'Simulando…' : 'Simular acreditamiento'}
      </TicketButton>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
