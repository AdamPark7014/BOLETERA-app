'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Field, TicketButton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { authHeaders, clearSession, getToken } from '@/lib/auth';
import styles from './vender.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const LOGIN_BACK = '/login?next=%2Fresale%2Fvender';

export default function ResaleSellPage() {
  const router = useRouter();
  const [ticketCode, setTicketCode] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!getToken()) {
      router.push(LOGIN_BACK);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/resale/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ticketCode: ticketCode.trim(),
          askingPrice: Number(askingPrice),
        }),
      });
      // Con la sesión de 2 h, caducar a mitad del formulario es normal.
      if (res.status === 401 || res.status === 403) {
        clearSession();
        setError('Tu sesión caducó. Vuelve a entrar y podrás publicar el boleto.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.message ?? 'No pudimos publicar el boleto. Revisa el código y el precio.'
        );
      }
      router.push('/resale');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos conectarnos. Revisa tu conexión e inténtalo otra vez.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <p className={styles.eyebrow}>Reventa oficial</p>
        <h1>Vender boleto</h1>
        <p className={styles.lead}>
          Publica un boleto de tu cuenta. El precio debe respetar el tope máximo que fija el evento.
        </p>

        <form onSubmit={submit} className={styles.form}>
          <Field
            id="ticket-code"
            name="ticketCode"
            label="Código del boleto"
            value={ticketCode}
            onChange={(e) => setTicketCode(e.target.value)}
            placeholder="BL-XXXX"
            hint="Lo encuentras en el detalle de la orden, junto al QR."
            autoComplete="off"
            required
          />

          <Field
            id="asking-price"
            name="askingPrice"
            label="Precio de reventa (MXN)"
            kind="money"
            type="number"
            inputMode="numeric"
            min={1}
            value={askingPrice}
            onChange={(e) => setAskingPrice(e.target.value)}
            required
          />

          {error && (
            <p className={styles.error} role="alert">
              {error}{' '}
              {error.startsWith('Tu sesión') && <Link href={LOGIN_BACK}>Volver a entrar</Link>}
            </p>
          )}

          <TicketButton type="submit" disabled={loading}>
            {loading ? 'Publicando…' : 'Publicar listado'}
          </TicketButton>
        </form>

        <Link href="/resale" className={styles.back}>
          Volver a reventa
        </Link>
      </main>
    </>
  );
}
