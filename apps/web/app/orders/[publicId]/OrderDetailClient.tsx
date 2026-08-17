'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { OrderQrCards } from '@/components/OrderQrCards';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import { fetchOrderResource, orderPath, resolveOrderAccessToken } from '@/lib/order-access';
import { isDeferredMethod } from '@/lib/payment-window';
import { formatMoney } from '@/lib/pricing';
import { DeferredPaymentPanel } from './DeferredPaymentPanel';
import { OrderAccessGate } from './OrderAccessGate';
import { TicketsPdfLink } from './TicketsPdfLink';
import styles from './order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type OrderTicket = {
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

type OrderDetail = {
  id: string;
  publicId: string;
  status: string;
  subtotal?: string;
  fees?: string;
  taxAmount?: string;
  discountAmount?: string;
  totalAmount: string;
  currency: string;
  buyerName?: string;
  buyerEmail?: string;
  paymentMethod?: string | null;
  /** Fecha límite real de pago; para OXXO/SPEI son horas, no minutos. */
  expiresAt?: string | null;
  event?: {
    title: string;
    slug: string;
    startsAt: string;
    endsAt?: string | null;
    venue?: { name: string; city: string; address?: string | null } | null;
  } | null;
  items: {
    quantity?: number;
    unitPrice?: string;
    offer?: { name?: string | null; zone?: string } | null;
    tickets: OrderTicket[];
  }[];
  pendingPayment?: {
    reference?: string | null;
    metadata?: {
      clabe?: string;
      concept?: string;
      type?: string;
      reference?: string;
      demo?: boolean;
    } | null;
  } | null;
};

function seatLabel(t: OrderTicket) {
  const parts = [
    t.section,
    t.row ? `Fila ${t.row}` : null,
    t.seatNumber ? `Asiento ${t.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function googleCalendarUrl(order: OrderDetail) {
  const ev = order.event;
  if (!ev?.startsAt) return null;
  const start = new Date(ev.startsAt);
  const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Orden ${order.publicId} · Boletos BOLETERA`,
    location: [ev.venue?.name, ev.venue?.address, ev.venue?.city].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; order: OrderDetail }
  | { phase: 'denied'; reason: 'forbidden' | 'not-found' | 'error'; message?: string };

/**
 * Detalle de la orden.
 *
 * Es cliente y no servidor a propósito: las tres credenciales posibles —el
 * `accessToken` del correo, su copia en `localStorage` y el JWT de la sesión—
 * viven en el navegador, así que un render en servidor no puede acreditar nada
 * y recibiría un 403 sistemático para el comprador invitado.
 */
export function OrderDetailClient({
  publicId,
  urlToken,
}: {
  publicId: string;
  urlToken?: string;
}) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [gatewayDemo, setGatewayDemo] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  /** Sin esto se dispararía una lectura sin credencial antes de leer el token. */
  const [tokenReady, setTokenReady] = useState(false);

  // El token del enlace se archiva al llegar: la siguiente visita desde este
  // dispositivo ya no depende de tener el correo a mano.
  useEffect(() => {
    setToken(resolveOrderAccessToken(publicId, urlToken));
    setTokenReady(true);
  }, [publicId, urlToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => setGatewayDemo(Boolean(cfg?.demo)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const load = useCallback(async () => {
    const result = await fetchOrderResource<OrderDetail>(API, publicId, '', token);
    if (result.ok) {
      setState({ phase: 'ready', order: result.data });
      return;
    }
    if (result.forbidden) {
      setState({ phase: 'denied', reason: 'forbidden' });
      return;
    }
    if (result.notFound) {
      setState({ phase: 'denied', reason: 'not-found' });
      return;
    }
    setState({ phase: 'denied', reason: 'error', message: result.message });
  }, [publicId, token]);

  useEffect(() => {
    if (!tokenReady) return;
    void load();
  }, [load, tokenReady]);

  // Pago diferido pendiente: el banco acredita minutos u horas después, así que
  // se sondea el estado público (sin PII) hasta que cambie.
  const pendingDeferred =
    state.phase === 'ready' &&
    state.order.status === 'PENDING' &&
    isDeferredMethod(state.order.paymentMethod);

  useEffect(() => {
    if (!pendingDeferred) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API}/orders/${publicId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'PENDING') void load();
      } catch {
        /* seguimos sondeando */
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [pendingDeferred, publicId, load]);

  if (state.phase === 'loading') {
    return (
      <div className={styles.shell}>
        <SiteHeader />
        <main className={styles.page}>
          {/* Esqueleto, no spinner de página: la estructura ya se ve. */}
          <div className={styles.skeleton} role="status" aria-live="polite">
            <span className={styles.srOnly}>Cargando tu orden…</span>
            <div className={styles.skelLine} />
            <div className={styles.skelBlock} />
            <div className={styles.skelBlock} />
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (state.phase === 'denied') {
    return <OrderAccessGate publicId={publicId} reason={state.reason} message={state.message} />;
  }

  const order = state.order;
  const tickets = order.items.flatMap((i) => i.tickets);
  const when = order.event?.startsAt ? new Date(order.event.startsAt) : null;
  const cal = googleCalendarUrl(order);
  const pendingMeta = order.pendingPayment?.metadata;
  const completed = order.status === 'COMPLETED';
  const isDemoFlow = gatewayDemo || pendingMeta?.demo === true;
  const method = (order.paymentMethod ?? '').toUpperCase();
  const showDeferred = order.status === 'PENDING' && (method === 'SPEI' || method === 'OXXO');
  const hasBreakdown = order.subtotal != null && order.fees != null && order.taxAmount != null;

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.steps} aria-label="Progreso">
          <span className={styles.stepDone}>1 Carrito</span>
          <span className={styles.stepDone}>2 Pago</span>
          <span className={styles.stepActive} aria-current="step">
            3 Boletos
          </span>
        </div>

        <header className={styles.hero}>
          {completed ? (
            <p className={styles.ok}>Compra confirmada</p>
          ) : (
            <p className={styles.pending}>
              {showDeferred ? 'Pendiente de pago' : 'Pago en proceso — Banorte'}
            </p>
          )}
          <h1>{completed ? 'Tus boletos están listos' : 'Completa tu pago'}</h1>
          <p className={styles.sub}>
            Orden <code>{order.publicId}</code>
            {order.buyerEmail ? ` · ${order.buyerEmail}` : ''}
          </p>
          {!token && (
            <p className={styles.gateNote}>
              Estás viendo esta orden con tu sesión iniciada. Para abrirla en otro dispositivo, usa
              el enlace del correo de confirmación.
            </p>
          )}
        </header>

        {order.event && (
          <section className={styles.eventCard} aria-label="Evento">
            <div>
              <p className={styles.kicker}>Evento</p>
              <h2>{order.event.title}</h2>
              {when && (
                <p>
                  {when.toLocaleDateString('es-MX', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  · {when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {order.event.venue && (
                <p>
                  {order.event.venue.name}
                  {order.event.venue.city ? ` · ${order.event.venue.city}` : ''}
                </p>
              )}
            </div>
            <div className={styles.eventSide}>
              <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
              <span className={styles.totalNote}>
                {completed ? 'Total cobrado' : 'Total a pagar'} · cargo por servicio e IVA incluidos
              </span>
              {order.event.slug && (
                <Link href={`/events/${order.event.slug}`} className={styles.textLink}>
                  Ver evento
                </Link>
              )}
            </div>
          </section>
        )}

        {hasBreakdown && (
          <section className={styles.section} aria-label="Desglose del importe">
            <h2>Desglose</h2>
            <ul className={styles.breakdown}>
              <li>
                <span>Precio de los boletos</span>
                <strong>{formatMoney(order.subtotal ?? 0, order.currency)}</strong>
              </li>
              <li>
                <span>Cargo por servicio</span>
                <strong>{formatMoney(order.fees ?? 0, order.currency)}</strong>
              </li>
              <li>
                <span>IVA</span>
                <strong>{formatMoney(order.taxAmount ?? 0, order.currency)}</strong>
              </li>
              {Number(order.discountAmount ?? 0) > 0 && (
                <li>
                  <span>Descuento</span>
                  <strong>−{formatMoney(order.discountAmount ?? 0, order.currency)}</strong>
                </li>
              )}
              <li className={styles.breakdownTotal}>
                <span>{completed ? 'Total cobrado' : 'Total a pagar'}</span>
                <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
              </li>
            </ul>
          </section>
        )}

        {showDeferred && (
          <>
            <DeferredPaymentPanel
              method={method as 'SPEI' | 'OXXO'}
              reference={
                pendingMeta?.reference || order.pendingPayment?.reference || order.publicId
              }
              clabe={pendingMeta?.clabe}
              concept={
                pendingMeta?.concept ||
                pendingMeta?.reference ||
                order.pendingPayment?.reference ||
                order.publicId
              }
              amount={order.totalAmount}
              currency={order.currency}
              expiresAt={order.expiresAt}
              demo={isDemoFlow}
              onExpire={() => void load()}
            />
            {isDemoFlow && (
              <SimulateDemoPaymentButton
                orderId={order.id}
                publicId={order.publicId}
                accessToken={token}
              />
            )}
          </>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Tus boletos ({tickets.length})</h2>
            {completed && (
              <TicketsPdfLink apiBase={API} publicId={order.publicId} accessToken={token} />
            )}
          </div>
          <ul className={styles.ticketList}>
            {tickets.map((t) => (
              <li key={t.code}>
                <code>{t.code}</code>
                <span>{seatLabel(t) || 'Entrada general'}</span>
              </li>
            ))}
            {!tickets.length && (
              <li className={styles.muted}>Los códigos QR aparecerán cuando el pago se confirme.</li>
            )}
          </ul>
        </section>

        {completed && <OrderQrCards publicId={order.publicId} accessToken={token} />}

        <div className={styles.actions}>
          {cal && completed && (
            <a className={styles.secondary} href={cal} target="_blank" rel="noreferrer">
              Agregar al calendario
            </a>
          )}
          <Link href="/cuenta" className={styles.link}>
            Ir a Mis boletos
          </Link>
          <Link href="/events" className={styles.ghost}>
            Ver más eventos
          </Link>
          {showDeferred && (
            <Link href={orderPath(order.publicId, token, '/pago', { method })} className={styles.ghost}>
              Ver instrucciones completas
            </Link>
          )}
        </div>

        <ul className={styles.trust}>
          <li>Boletos oficiales BOLETERA</li>
          <li>Entrada con QR</li>
          <li>Pago Banorte</li>
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
