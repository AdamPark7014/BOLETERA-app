'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { NamedStatus, TicketButton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { API_BASE as API } from '@/lib/api';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, clearSession, getToken } from '@/lib/auth';
import { formatMoney } from '@/lib/pricing';
import purchase from '@/components/purchase/purchase.module.scss';

type ResaleCheckout = {
  id: string;
  publicId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'PENDING_REFUND' | string;
  eventTitle: string;
  seat: string;
  amount: string;
  fee: string;
  currency: string;
  expiresAt: string;
  orderPublicId: string | null;
};

function secondsLeft(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

/**
 * Pago de un boleto de reventa. El boleto queda apartado 15 min; al confirmarse
 * el cobro pasa a tu cuenta con un QR nuevo y te llevamos a tus boletos.
 */
export default function ReventaPagoPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const router = useRouter();
  const [checkout, setCheckout] = useState<ResaleCheckout | null>(null);
  const [loadError, setLoadError] = useState<ApiErrorInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [, setTick] = useState(0);
  const back = `/login?next=${encodeURIComponent(`/resale/pago/${publicId}`)}`;

  const load = useCallback(async () => {
    if (!publicId) return;
    try {
      const res = await fetch(`${API}/resale/checkouts/${encodeURIComponent(publicId)}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (res.status === 401) {
        clearSession();
        router.replace(back);
        return;
      }
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setLoadError(await readApiError(res, 'No pudimos leer tu compra'));
        return;
      }
      const data = (await res.json()) as ResaleCheckout;
      setCheckout(data);
      setLoadError(null);
      if (data.status === 'COMPLETED') router.replace('/cuenta?reventa=comprada');
    } catch (e) {
      setLoadError(networkError(e));
    }
  }, [publicId, router, back]);

  useEffect(() => {
    if (!getToken()) {
      router.replace(back);
      return;
    }
    void load();
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => setDemo(Boolean(cfg?.demo)))
      .catch(() => {});
    return () => controller.abort();
  }, [load, router, back]);

  const pending = checkout?.status === 'PENDING';
  useEffect(() => {
    if (!pending) return;
    const poll = setInterval(() => void load(), 4000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [pending, load]);

  async function simulate() {
    if (!checkout) return;
    setSimulating(true);
    setSimError(null);
    try {
      const res = await fetch(
        `${API}/resale/checkouts/${encodeURIComponent(checkout.publicId)}/demo-confirm`,
        { method: 'POST', headers: { ...authHeaders() }, cache: 'no-store' }
      );
      if (!res.ok) {
        setSimError((await readApiError(res, 'No se pudo simular el pago')).message);
        return;
      }
      await load();
    } catch (e) {
      setSimError(networkError(e).message);
    } finally {
      setSimulating(false);
    }
  }

  const left = checkout ? secondsLeft(checkout.expiresAt) : 0;
  const expired = pending && left <= 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <>
      <SiteHeader />
      <main id="contenido" className={purchase.column}>
        <div className={purchase.stack}>
          <div className={purchase.chips}>
            <NamedStatus status={checkout?.status === 'COMPLETED' ? 'cobrado' : 'pendiente'} />
            {pending && !expired ? (
              <span className={purchase.clock} aria-live="polite">
                Apartado {clock}
              </span>
            ) : null}
          </div>
          <h1 className={purchase.title}>Boleto de reventa</h1>
          {checkout ? (
            <p className={purchase.lead}>
              {checkout.eventTitle}
              {checkout.seat ? ` · ${checkout.seat}` : ''}
            </p>
          ) : null}
        </div>

        {notFound ? (
          <div className={purchase.error} role="alert">
            <span>No encontramos esta compra en tu cuenta.</span>
            <Link href="/resale" className={purchase.link}>
              Volver a la reventa
            </Link>
          </div>
        ) : null}

        {loadError ? (
          <div className={purchase.error} role="alert">
            <span>{loadError.message}</span>
            <TicketButton type="button" variant="secondary" onClick={() => void load()}>
              Reintentar
            </TicketButton>
          </div>
        ) : null}

        {!checkout && !notFound && !loadError ? (
          <p className={purchase.caption} role="status">
            Cargando tu compra.
          </p>
        ) : null}

        {checkout ? (
          <dl className={purchase.stack}>
            <div className={purchase.chips}>
              <dt>Total</dt>
              <dd>
                <strong>{formatMoney(checkout.amount, checkout.currency)}</strong>
              </dd>
            </div>
            <div className={purchase.caption}>
              Incluye cargo por servicio de {formatMoney(checkout.fee, checkout.currency)}. El QR
              del vendedor deja de valer y recibes uno nuevo.
            </div>
          </dl>
        ) : null}

        {pending && !expired ? (
          <p className={purchase.lead} aria-live="polite">
            {demo
              ? 'Pasarela en demostración: el cargo no cobra. Simula la confirmación del banco.'
              : 'Esperando la confirmación del banco. No vuelvas a pagar: en cuanto llegue, el boleto aparece en tu cuenta.'}
          </p>
        ) : null}

        {pending && !expired && demo ? (
          <div className={purchase.stack}>
            <TicketButton type="button" onClick={() => void simulate()} disabled={simulating}>
              {simulating ? 'Simulando' : 'Simular pago (demo)'}
            </TicketButton>
            {simError ? (
              <div className={purchase.error} role="alert">
                <span>{simError}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {expired ? (
          <div className={purchase.error} role="alert">
            <span>Se acabó el tiempo del apartado. El boleto volvió a la reventa.</span>
            <Link href="/resale" className={purchase.link}>
              Volver a la reventa
            </Link>
          </div>
        ) : null}

        {checkout?.status === 'FAILED' ? (
          <div className={purchase.error} role="alert">
            <span>El banco rechazó el pago. No se hizo ningún cargo.</span>
            <Link href="/resale" className={purchase.link}>
              Intentar de nuevo
            </Link>
          </div>
        ) : null}

        {checkout?.status === 'PENDING_REFUND' ? (
          <div className={purchase.error} role="alert">
            <span>
              El cobro entró, pero el boleto ya no estaba disponible. Te devolvemos el dinero y te
              escribimos por correo.
            </span>
          </div>
        ) : null}

        <div className={purchase.actions}>
          <Link href="/cuenta" className={purchase.link}>
            Ir a mi cuenta
          </Link>
          <Link href="/ayuda" className={purchase.link}>
            Necesito ayuda
          </Link>
        </div>
      </main>
    </>
  );
}
