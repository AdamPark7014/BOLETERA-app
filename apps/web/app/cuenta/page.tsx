'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { useTenantBrand } from '@/components/TenantBrand';
import { authHeaders, clearSession, getStoredUser, getToken } from '@/lib/auth';
import { formatMoney } from '@/lib/pricing';
import {
  type OrderRefund,
  formatPolicyDate,
  formatShortDate,
  orderHasRefund,
  refundDeadlines,
  refundFallbackCopy,
  refundMethodLabel,
  refundStatusCopy,
  summarizeRefunds,
} from '@/lib/refund-policy';
import styles from './cuenta.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const LOGIN_BACK = '/login?next=%2Fcuenta';

type TicketRow = {
  id: string;
  code: string;
  status: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  event: {
    title: string;
    slug: string;
    startsAt: string;
    venue?: { name: string; city: string } | null;
    /** Un evento caído no puede seguir anunciándose como «próximo». */
    status?: string | null;
    cancelledAt?: string | null;
  };
  organizationId?: string;
  items?: { tickets?: TicketRow[]; quantity?: number }[];
  currency?: string;
  paymentMethod?: string | null;
  /** Momento en que se asentó la devolución: de ahí sale el plazo prometido. */
  refundedAt?: string | null;
  /**
   * Filas de `Refund` de la orden. Con ellas se dice el importe devuelto de
   * verdad —y se separa la bonificación—; sin ellas solo se puede hablar del
   * estado, nunca inventar una cifra.
   */
  refunds?: OrderRefund[] | null;
};

type TransferRow = {
  id: string;
  transferCode: string;
  toEmail: string;
  status: string;
  ticket: { code: string; event: { title: string } };
};

/** Etiquetas de estado en español: la API devuelve constantes en inglés. */
const ORDER_STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Pagada',
  PENDING: 'Pendiente de pago',
  PROCESSING: 'Procesando',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Reembolsada',
  PARTIALLY_REFUNDED: 'Reembolsada en parte',
  // El comprador no sabe qué es «PENDING_REFUND»; lo que sí sabe es que le
  // cobraron y no tiene boletos. Se le dice eso.
  PENDING_REFUND: 'Te cobramos sin poder emitir: devolución en proceso',
  EXPIRED: 'Expirada',
  FAILED: 'Pago rechazado',
};

type LoadState = 'loading' | 'ready' | 'expired' | 'error';

function seatLabel(t: TicketRow) {
  const parts = [
    t.section,
    t.row ? `Fila ${t.row}` : null,
    t.seatNumber ? `Asiento ${t.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export default function CuentaPage() {
  const router = useRouter();
  const brand = useTenantBrand();
  const [user, setUser] = useState<ReturnType<typeof getStoredUser>>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [transferCode, setTransferCode] = useState('');
  const [transferForm, setTransferForm] = useState({ ticketId: '', toEmail: '', message: '' });
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [cfdiOrderId, setCfdiOrderId] = useState('');
  const [cfdiForm, setCfdiForm] = useState({ rfc: '', nombre: '' });
  const [cfdiBusy, setCfdiBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);

  function showToast(type: 'ok' | 'err', text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 6000);
  }

  /*
   * El JWT dura 2 h y se revoca al cambiar el usuario, así que un 401 aquí es
   * rutina. Antes se tragaba el error y la lista quedaba vacía: parecía que no
   * habías comprado nada. Ahora se distingue sesión caducada de fallo de red y
   * cada caso dice qué hacer.
   */
  const reload = useCallback(async () => {
    const headers = authHeaders();
    try {
      const [ordersRes, transfersRes] = await Promise.all([
        fetch(`${API}/orders/mine`, { headers, cache: 'no-store' }),
        fetch(`${API}/tickets/transfer/mine`, { headers, cache: 'no-store' }),
      ]);

      if (ordersRes.status === 401 || ordersRes.status === 403) {
        clearSession();
        setState('expired');
        return;
      }
      if (!ordersRes.ok) {
        setState('error');
        return;
      }

      setOrders((await ordersRes.json()) as OrderRow[]);

      if (transfersRes.ok) {
        const t = (await transfersRes.json()) as {
          sent?: TransferRow[];
          received?: TransferRow[];
        };
        setTransfers([...(t.sent ?? []), ...(t.received ?? [])]);
      } else {
        setTransfers([]);
      }
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace(LOGIN_BACK);
      return;
    }
    setUser(getStoredUser());
    const p = new URLSearchParams(window.location.search);
    const code = p.get('transfer');
    if (code) {
      setTransferCode(code);
      setShowTools(true);
    }
    void reload();
  }, [router, reload]);

  const myTickets = orders.flatMap(
    (o) =>
      o.items?.flatMap((i) =>
        (i.tickets ?? []).map((t) => ({
          ...t,
          eventTitle: o.event.title,
        })),
      ) ?? [],
  );

  const completedOrders = orders.filter((o) => o.status === 'COMPLETED');

  const upcoming = useMemo(() => {
    const now = Date.now();
    return completedOrders
      .filter((o) => new Date(o.event.startsAt).getTime() >= now - 6 * 60 * 60 * 1000)
      .sort(
        (a, b) =>
          new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime(),
      );
  }, [completedOrders]);

  const past = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((o) => o.publicId));
    return orders.filter((o) => !upcomingIds.has(o.publicId));
  }, [orders, upcoming]);

  /*
   * Reembolsos en curso, arriba y sin abrir orden por orden.
   *
   * Es la pregunta que el comprador viene a hacerse ("¿y mi dinero?") y hasta
   * ahora obligaba a entrar en cada orden a leer un estado en inglés.
   *
   * Manda el estado de la DEVOLUCIÓN, no el de la orden. Son cosas distintas y
   * confundirlas se notaba: una orden `REFUNDED` cuyo envío al banco falló
   * salía aquí como «Reembolso aprobado», que es exactamente lo contrario de
   * lo que había pasado. Y el importe sale de las filas de `Refund`, no del
   * total de la orden, que en una devolución parcial es sencillamente otra
   * cifra.
   */
  const refunds = useMemo(
    () =>
      orders
        .filter((o) => orderHasRefund(o.status) || (o.refunds?.length ?? 0) > 0)
        .map((o) => {
          const currency = o.currency ?? 'MXN';
          const methodLabel = refundMethodLabel(o.paymentMethod);
          const summary = summarizeRefunds(o.refunds);

          // Sin filas de `Refund` no hay importe ni fecha que afirmar: se dice
          // lo que se sabe y se remite al detalle, en vez de fabricar una
          // promesa. (Con el API al día esto es ya el caso raro.)
          if (!summary) {
            const fallback = refundFallbackCopy(o.status);
            return {
              order: o,
              headline: fallback?.headline ?? 'Devolución en proceso',
              tone: fallback?.tone ?? ('progress' as const),
              // En una devolución PARCIAL el total de la orden no es lo que se
              // devuelve: enseñarlo sería afirmar una cifra que nadie calculó.
              amount:
                o.status === 'PARTIALLY_REFUNDED'
                  ? null
                  : formatMoney(o.totalAmount, currency),
              compensation: null,
              when:
                `Vuelve por ${methodLabel}. Te avisamos por correo en cuanto quede ` +
                'autorizado, con el importe y la fecha.',
            };
          }

          // El plazo cuenta desde que se asentó la devolución, no desde hoy:
          // si contara desde el render, la fecha se correría en cada recarga.
          const anchor = summary.requestedAt ?? (o.refundedAt ? new Date(o.refundedAt) : null);
          const deadlines = anchor ? refundDeadlines(anchor) : null;
          const copy = refundStatusCopy(summary.status, {
            methodLabel,
            sentBy: deadlines ? formatPolicyDate(deadlines.sentBy) : '—',
            visibleBy: deadlines ? formatPolicyDate(deadlines.visibleBy) : '—',
          });

          return {
            order: o,
            headline: copy.headline,
            tone: copy.tone,
            amount: formatMoney(summary.refundedTotal, currency),
            // La bonificación del art. 92 Bis se cuenta aparte: sumarla al
            // reembolso borraría la distinción que la ley establece —una repara
            // el cobro, la otra indemniza— y abultaría la devolución.
            compensation:
              summary.compensationTotal > 0
                ? formatMoney(summary.compensationTotal, currency)
                : null,
            when:
              // Con el envío fallado o en aclaración no hay fecha que prometer.
              copy.tone === 'alert'
                ? `Vuelve por ${methodLabel}. Te escribimos en cuanto haya novedad.`
                : deadlines
                  ? `Lo verás abonado a más tardar el ${formatPolicyDate(deadlines.visibleBy)}, ` +
                    `por ${methodLabel}.`
                  : `Vuelve por ${methodLabel}.`,
          };
        }),
    [orders],
  );

  /** Cualquier mutación puede toparse con la sesión caducada a mitad de camino. */
  function handleAuthFailure(res: Response) {
    if (res.status === 401 || res.status === 403) {
      clearSession();
      setState('expired');
      return true;
    }
    return false;
  }

  async function acceptTransfer(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/tickets/transfer/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ transferCode }),
    });
    if (handleAuthFailure(res)) return;
    if (!res.ok) {
      showToast('err', 'No se pudo aceptar la transferencia. Revisa que el código sea correcto.');
      return;
    }
    setTransferCode('');
    showToast('ok', 'Transferencia aceptada. El boleto ya está en tu cuenta.');
    void reload();
  }

  async function sendTransfer(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/tickets/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(transferForm),
    });
    if (handleAuthFailure(res)) return;
    if (!res.ok) {
      showToast('err', 'No se pudo iniciar la transferencia. Inténtalo de nuevo.');
      return;
    }
    setTransferForm({ ticketId: '', toEmail: '', message: '' });
    showToast('ok', 'Transferencia enviada: el destinatario recibirá un código por correo.');
    void reload();
  }

  async function requestCfdi(e: FormEvent) {
    e.preventDefault();
    if (!cfdiOrderId) return;
    setCfdiBusy(true);
    try {
      const order = orders.find((o) => o.publicId === cfdiOrderId);
      const res = await fetch(`${API}/orders/${cfdiOrderId}/cfdi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          receptorRfc: cfdiForm.rfc,
          receptorNombre: cfdiForm.nombre,
          orderId: order?.id,
        }),
      });
      if (handleAuthFailure(res)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('err', data.message || 'No se pudo solicitar la factura. Inténtalo más tarde.');
        return;
      }
      showToast('ok', data.sandbox ? `CFDI de prueba: ${data.uuid}` : `CFDI: ${data.uuid}`);
      setCfdiForm({ rfc: '', nombre: '' });
    } finally {
      setCfdiBusy(false);
    }
  }

  function logout() {
    clearSession();
    router.push('/');
  }

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        {toast && (
          <p className={toast.type === 'ok' ? styles.toastOk : styles.toastErr} role="status">
            {toast.text}
          </p>
        )}

        <header className={styles.hero}>
          <p className={styles.eyebrow}>Cuenta {brand.name}</p>
          <h1>Mis boletos</h1>
          {user && (
            <p className={styles.user}>
              {user.firstName} {user.lastName} · {user.email}
            </p>
          )}
          <div className={styles.heroActions}>
            <Link href="/" className={styles.browse}>
              Explorar eventos
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={logout}
              className={styles.logout}
            >
              Cerrar sesión
            </Button>
          </div>
        </header>

        {state === 'expired' ? (
          <section className={styles.sessionExpired} role="alert" aria-labelledby="expired-title">
            <h2 id="expired-title">Tu sesión caducó</h2>
            <p>
              Por seguridad, cerramos la sesión después de un rato o cuando cambian los
              datos de tu cuenta. Tus boletos siguen guardados: vuelve a entrar y
              regresarás a esta misma página.
            </p>
            <Link href={LOGIN_BACK} className={styles.browse}>
              Volver a entrar
            </Link>
          </section>
        ) : state === 'error' ? (
          <section className={styles.loadError} role="alert" aria-labelledby="error-title">
            <h2 id="error-title">No pudimos cargar tus boletos</h2>
            <p>
              Puede ser tu conexión o algo temporal de nuestro lado. Tus compras no se
              pierden: vuelve a intentarlo.
            </p>
            <button
              type="button"
              className={styles.retry}
              onClick={() => {
                setState('loading');
                void reload();
              }}
            >
              Reintentar
            </button>
          </section>
        ) : (
          <>
            {refunds.length > 0 && (
              <section className={styles.refunds} aria-labelledby="refunds-title">
                <h2 id="refunds-title">
                  Tu dinero de vuelta ({refunds.length}
                  {refunds.length === 1 ? ' orden' : ' órdenes'})
                </h2>
                <ul className={styles.refundList}>
                  {refunds.map(({ order, headline, tone, amount, compensation, when }) => (
                    <li key={order.publicId}>
                      <div className={styles.refundMain}>
                        <p className={styles.refundEvent}>{order.event.title}</p>
                        {/*
                          El estado va en palabras, no solo en color: el tono es
                          apoyo visual y nunca el único portador del significado
                          (WCAG 1.4.1).
                        */}
                        <p
                          className={
                            tone === 'alert'
                              ? `${styles.refundState} ${styles.refundStateAlert}`
                              : styles.refundState
                          }
                        >
                          {headline}
                        </p>
                        <p className={styles.refundWhen}>{when}</p>
                      </div>
                      <div className={styles.refundSide}>
                        {/* Sin importe conocido no se escribe una cifra falsa. */}
                        {amount ? <strong>{amount}</strong> : <strong aria-hidden="true">—</strong>}
                        {compensation && (
                          <span className={styles.refundBonus}>+ {compensation} de bonificación</span>
                        )}
                        <Link href={`/orders/${order.publicId}`} className={styles.refundLink}>
                          Ver detalle
                          <span className={styles.srOnly}> del reembolso de {order.event.title}</span>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className={styles.wallet} aria-labelledby="wallet-title">
              <div className={styles.walletHead}>
                <h2 id="wallet-title">Próximos</h2>
                <p className={styles.hint}>
                  Abre el detalle para ver el QR, descargar el PDF y transferir boletos.
                </p>
              </div>

              {state === 'loading' && (
                <p className={styles.loading} role="status">
                  Cargando tus boletos…
                </p>
              )}

              {state === 'ready' && upcoming.length === 0 && (
                <EmptyState
                  title="Sin boletos próximos"
                  description="Cuando compres, tus entradas aparecerán aquí listas para el evento."
                  action={
                    <Link href="/" className={styles.browse}>
                      Ver cartelera
                    </Link>
                  }
                />
              )}

              <ul className={styles.walletList}>
                {upcoming.map((o) => {
                  const when = new Date(o.event.startsAt);
                  const tickets = o.items?.flatMap((i) => i.tickets ?? []) ?? [];
                  const count =
                    tickets.length ||
                    o.items?.reduce((s, i) => s + (i.quantity ?? 0), 0) ||
                    0;
                  const cancelled = o.event.status === 'CANCELLED';
                  return (
                    <li key={o.publicId} className={styles.walletCard}>
                      <div className={styles.walletDateBlock} aria-hidden="true">
                        <strong>{when.toLocaleDateString('es-MX', { day: '2-digit' })}</strong>
                        <span>
                          {when.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}
                        </span>
                      </div>
                      <div className={styles.walletBody}>
                        <p className={styles.walletDate}>
                          {when.toLocaleDateString('es-MX', { weekday: 'short' })} ·{' '}
                          {when.toLocaleTimeString('es-MX', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <strong className={styles.walletTitle}>{o.event.title}</strong>
                        <p className={styles.walletMeta}>
                          {o.event.venue?.name}
                          {o.event.venue?.city ? ` · ${o.event.venue.city}` : ''}
                          {count ? ` · ${count} boleto${count === 1 ? '' : 's'}` : ''}
                        </p>
                        {/*
                          Si el evento se cayó, esa es la noticia. Sin este
                          aviso la tarjeta seguía anunciándolo como próximo y el
                          comprador solo se enteraba entrando orden por orden
                          —o el día del evento, en la puerta.
                        */}
                        {cancelled && (
                          <p className={styles.walletCancelled}>
                            Evento cancelado
                            {o.event.cancelledAt
                              ? ` el ${formatShortDate(o.event.cancelledAt)}`
                              : ''}
                            . Tus boletos ya no sirven para entrar y la devolución la iniciamos
                            nosotros: no tienes que hacer ningún trámite.
                          </p>
                        )}
                        {!cancelled &&
                          tickets.slice(0, 2).map((t) => (
                            <p key={t.id} className={styles.walletSeat}>
                              {seatLabel(t) || t.code}
                            </p>
                          ))}
                      </div>
                      {/*
                        De un evento cancelado no se ofrece «Ver QR» ni el PDF:
                        invitar a preparar la entrada de algo que no se va a
                        celebrar contradice el aviso de arriba y manda al
                        comprador a la puerta con un código muerto.
                      */}
                      <div className={styles.walletActions}>
                        {cancelled ? (
                          <Link href={`/orders/${o.publicId}`} className={styles.qrCta}>
                            Ver reembolso
                          </Link>
                        ) : (
                          <>
                            <Link href={`/orders/${o.publicId}`} className={styles.qrCta}>
                              Ver QR
                            </Link>
                            <a href={`${API}/orders/${o.publicId}/tickets.pdf`}>Descargar PDF</a>
                            <Link href={`/events/${o.event.slug}`}>Ver evento</Link>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <button
              type="button"
              className={styles.toolsToggle}
              onClick={() => setShowTools((v) => !v)}
              aria-expanded={showTools}
              aria-controls="cuenta-tools"
            >
              {showTools ? 'Ocultar herramientas' : 'Transferencias y factura'}
            </button>

            <div id="cuenta-tools" hidden={!showTools}>
              {transferCode && (
                <section className={styles.section}>
                  <h2>Aceptar boleto</h2>
                  <form onSubmit={acceptTransfer} className={styles.formRow}>
                    <Input
                      label="Código de transferencia"
                      value={transferCode}
                      onChange={(e) => setTransferCode(e.target.value)}
                      required
                    />
                    <Button type="submit" size="md">
                      Aceptar transferencia
                    </Button>
                  </form>
                </section>
              )}

              <section className={styles.section}>
                <h2>Transferir boleto</h2>
                {myTickets.length === 0 ? (
                  <p className={styles.hint}>
                    Todavía no tienes boletos que puedas transferir.
                  </p>
                ) : (
                  <form onSubmit={sendTransfer} className={styles.formStack}>
                    <label htmlFor="transfer-ticket" className={styles.fieldLabel}>
                      Boleto que quieres ceder
                    </label>
                    <select
                      id="transfer-ticket"
                      value={transferForm.ticketId}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, ticketId: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecciona un boleto</option>
                      {myTickets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} — {t.eventTitle}
                        </option>
                      ))}
                    </select>
                    <Input
                      label="Correo del destinatario"
                      type="email"
                      value={transferForm.toEmail}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, toEmail: e.target.value })
                      }
                      required
                    />
                    <Input
                      label="Mensaje (opcional)"
                      value={transferForm.message}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, message: e.target.value })
                      }
                    />
                    <Button type="submit" size="md">
                      Enviar transferencia
                    </Button>
                  </form>
                )}
              </section>

              <section className={styles.section}>
                <h2>Factura CFDI (entorno de pruebas)</h2>
                {completedOrders.length === 0 ? (
                  <p className={styles.hint}>
                    Cuando tengas una orden pagada podrás pedir su factura desde aquí.
                  </p>
                ) : (
                  <>
                    <p className={styles.hint}>
                      Solicita el timbrado de prueba para una orden ya pagada.
                    </p>
                    <form onSubmit={requestCfdi} className={styles.formStack}>
                      <label htmlFor="cfdi-order" className={styles.fieldLabel}>
                        Orden a facturar
                      </label>
                      <select
                        id="cfdi-order"
                        value={cfdiOrderId}
                        onChange={(e) => setCfdiOrderId(e.target.value)}
                        required
                      >
                        <option value="">Selecciona una orden pagada</option>
                        {completedOrders.map((o) => (
                          <option key={o.publicId} value={o.publicId}>
                            {o.event.title} · {o.publicId}
                          </option>
                        ))}
                      </select>
                      <Input
                        label="RFC del receptor"
                        value={cfdiForm.rfc}
                        onChange={(e) => setCfdiForm({ ...cfdiForm, rfc: e.target.value })}
                        required
                        minLength={12}
                        maxLength={13}
                      />
                      <Input
                        label="Razón social o nombre"
                        value={cfdiForm.nombre}
                        onChange={(e) => setCfdiForm({ ...cfdiForm, nombre: e.target.value })}
                        required
                      />
                      <Button type="submit" size="md" disabled={cfdiBusy}>
                        {cfdiBusy ? 'Timbrando…' : 'Solicitar CFDI'}
                      </Button>
                    </form>
                  </>
                )}
              </section>

              {transfers.length > 0 && (
                <section className={styles.section}>
                  <h2>Mis transferencias</h2>
                  <ul className={styles.list}>
                    {transfers.map((t) => (
                      <li key={t.id}>
                        <strong>{t.ticket.event.title}</strong> → {t.toEmail}
                        <br />
                        <small>
                          Código {t.transferCode} · {t.status}
                        </small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {state === 'ready' && past.length > 0 && (
              <section className={styles.section}>
                <h2>Historial</h2>
                <ul className={styles.list}>
                  {past.map((o) => (
                    <li key={o.publicId}>
                      <div>
                        <strong>{o.event.title}</strong>
                        <span className={styles.status}>
                          {ORDER_STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </div>
                      <p>${o.totalAmount}</p>
                      <div className={styles.orderLinks}>
                        <Link href={`/orders/${o.publicId}`}>Ver detalle</Link>
                        {o.status === 'COMPLETED' && (
                          <a href={`${API}/orders/${o.publicId}/tickets.pdf`}>PDF de boletos</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
