'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE as API } from '@/lib/api';
import { networkError, readApiError } from '@/lib/api-errors';
import { authHeaders, clearSession, getToken } from '@/lib/auth';
import styles from './resale.module.scss';

/**
 * «Comprar» real de un anuncio de reventa: aparta el boleto y lleva al pago.
 * Sin sesión, al login y de vuelta a la reventa.
 */
export function BuyResaleButton({ listingId, label }: { listingId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginBack = `/login?next=${encodeURIComponent('/resale')}`;

  async function buy() {
    if (!getToken()) {
      router.push(loginBack);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/resale/listings/${encodeURIComponent(listingId)}/buy`, {
        method: 'POST',
        headers: { ...authHeaders() },
      });
      if (res.status === 401) {
        clearSession();
        router.push(loginBack);
        return;
      }
      if (!res.ok) {
        setError((await readApiError(res, 'No pudimos apartar este boleto')).message);
        return;
      }
      const checkout = (await res.json()) as {
        publicId: string;
        payment: { redirectUrl: string | null; demo: boolean };
      };
      if (checkout.payment.redirectUrl && !checkout.payment.demo) {
        window.location.href = checkout.payment.redirectUrl;
        return;
      }
      router.push(`/resale/pago/${encodeURIComponent(checkout.publicId)}`);
    } catch (e) {
      setError(networkError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.buy} onClick={() => void buy()} disabled={busy}>
        {busy ? 'Apartando…' : label}
      </button>
      {error ? (
        <p className={styles.buyError} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
