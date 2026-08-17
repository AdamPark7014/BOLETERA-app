'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { networkError, readApiError } from '@/lib/api-errors';
import { fetchOrderResource, orderPath, readStoredOrderAccessToken } from '@/lib/order-access';
import styles from './SimulateDemoPaymentButton.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

/**
 * Control solo-demo: completa una orden SPEI/OXXO pendiente vía
 * `POST /payments/confirm`. El llamador solo debe renderizarlo con Banorte en
 * modo demo.
 *
 * Si no recibe `orderId` tiene que leer la orden para obtenerlo, y esa lectura
 * ya exige credencial: sin el `accessToken` devolvía 403 y el botón fallaba en
 * el mismo flujo de invitado que existe para probar.
 */
export function SimulateDemoPaymentButton({
  orderId,
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

  async function resolveOrderId(): Promise<string> {
    if (orderId) return orderId;
    const res = await fetchOrderResource<{ id?: string }>(API, publicId, '', token);
    if (!res.ok) {
      throw new Error(
        res.forbidden
          ? 'Abre la orden desde el enlace del correo para simular el pago.'
          : res.message,
      );
    }
    if (!res.data.id) throw new Error('Orden sin id');
    return res.data.id;
  }

  async function simulate() {
    setBusy(true);
    setError('');
    try {
      const resolvedId = await resolveOrderId();
      const res = await fetch(`${API}/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: resolvedId,
          externalId: `banorte_demo_${publicId}`,
        }),
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
      <button
        type="button"
        className={styles.btn}
        onClick={() => void simulate()}
        disabled={busy || !publicId}
        aria-busy={busy}
      >
        {busy ? 'Simulando…' : 'Simular acreditamiento'}
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
