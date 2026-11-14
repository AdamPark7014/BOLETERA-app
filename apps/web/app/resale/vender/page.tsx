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

/**
 * El API de reventa responde varios mensajes en inglés («Price must be between
 * 560.00 and 2240.00»). Aquí se traducen a algo que el vendedor entienda; lo
 * que ya viene en español pasa tal cual.
 */
function resaleErrorMessage(status: number, raw?: string | string[]): string {
  const message = (Array.isArray(raw) ? raw.join('. ') : raw)?.trim() ?? '';
  const range = /price must be between ([\d.]+) and ([\d.]+)/i.exec(message);
  if (range) {
    const fmt = (v: string) =>
      Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    return `El precio debe estar entre ${fmt(range[1])} y ${fmt(range[2])}.`;
  }
  if (/ticket not found/i.test(message) || status === 404) {
    return 'No encontramos ese código de boleto. Cópialo tal cual del detalle de tu orden.';
  }
  if (/must be in sold status/i.test(message)) {
    return 'Ese boleto no se puede publicar: ya está en reventa, se usó o se reembolsó.';
  }
  if (/order history/i.test(message)) {
    return 'Ese boleto no viene de una compra y no se puede revender.';
  }
  if (/resale not allowed/i.test(message)) {
    return 'Este evento no permite reventa.';
  }
  // Mensajes con acentos o eñes ya vienen en español desde el API.
  if (message && /[áéíóúñ¿¡]/i.test(message)) return message;
  if (status === 403) return 'Solo el dueño del boleto puede publicarlo en reventa.';
  return 'No pudimos publicar el boleto. Revisa el código y el precio.';
}

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
      // Con la sesión de 2 h, caducar a mitad del formulario es normal. Solo el
      // 401 es sesión caducada: el 403 es «ese boleto no es tuyo» y antes
      // cerraba la sesión del comprador por teclear mal un código.
      if (res.status === 401) {
        clearSession();
        setError('Tu sesión caducó. Vuelve a entrar y podrás publicar el boleto.');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
      if (!res.ok) {
        throw new Error(resaleErrorMessage(res.status, data.message));
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
