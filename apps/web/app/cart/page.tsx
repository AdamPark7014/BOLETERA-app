'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import {
  normalizeCartItem,
  secondsUntil,
  useCartStore,
  type CartItem,
} from '@/lib/cart-store';
import { authHeaders } from '@/lib/auth';
import { getGuestSessionId } from '@/lib/guest-session';
import { formatCountdown } from '@/lib/payment-window';
import { fetchCartPricing, formatMoney, type CartPricing } from '@/lib/pricing';
import styles from './cart.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Quitar del carrito tiene que devolver la butaca a la venta.
 *
 * Antes solo se borraba la entrada local y el hold seguía vivo en el servidor
 * hasta expirar: inventario congelado durante quince minutos por cada
 * arrepentimiento, justo en el momento de un onsale en el que más falta hace.
 * El API exige propiedad para liberar, y la propiedad se acredita con el
 * `sessionId` estable del navegador (o con el JWT si hay sesión).
 *
 * Es best-effort a propósito: si la liberación falla, el hold caduca solo y el
 * comprador no se queda con el carrito bloqueado por un error de red.
 */
function releaseHolds(item: CartItem) {
  const holdIds = item.lines?.flatMap((l) => l.holdIds) ?? item.holdIds ?? [];
  if (!holdIds.length) return;
  const sessionId = getGuestSessionId();
  for (const id of holdIds) {
    void fetch(`${API}/inventory/holds/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      // El `sessionId` va en el cuerpo, no en la URL: es un identificador de
      // sesión y no debe acabar en los registros de acceso del servidor.
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).catch(() => {});
  }
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function seatSummary(item: CartItem) {
  const labels =
    item.lines?.flatMap((l) => l.seatLabels ?? []) ?? item.seatLabels ?? [];
  if (!labels.length) return null;
  const shown = labels.slice(0, 6).join(' · ');
  return labels.length > 6 ? `${shown}…` : shown;
}

function lineBreakdown(item: CartItem) {
  if (!item.lines?.length) return null;
  if (item.lines.length === 1 && !item.lines[0].offerName) return null;
  return item.lines
    .map((l) => `${l.offerName || 'Zona'} ×${l.quantity || l.holdIds.length}`)
    .join(' · ');
}

/** Solo el precio de lista que trae el carrito: aún sin cargos ni IVA. */
function itemSubtotal(item: CartItem) {
  const fromLines = item.lines?.reduce((s, l) => s + (l.lineTotal ?? 0), 0) ?? 0;
  if (fromLines > 0) return fromLines;
  return item.lineTotal ?? 0;
}

function pricingItemsFor(item: CartItem) {
  return (item.lines ?? [])
    .map((l) => ({ offerId: l.offerId, quantity: l.quantity || l.holdIds.length }))
    .filter((l) => l.offerId && l.quantity > 0);
}

function goCheckout(router: ReturnType<typeof useRouter>, item: CartItem) {
  const normalized = normalizeCartItem(item);
  const lines = normalized.lines?.length
    ? normalized.lines
    : normalized.offerId && normalized.holdIds
      ? [{ offerId: normalized.offerId, holdIds: normalized.holdIds }]
      : [];
  const params = new URLSearchParams({
    eventId: normalized.eventId,
    holdIds: lines.flatMap((l) => l.holdIds).join(','),
    expiresAt: normalized.expiresAt,
  });
  if (lines.length === 1) params.set('offerId', lines[0].offerId);
  router.push(`/checkout?${params}`);
}

export default function CartPage() {
  const rawItems = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const clear = useCartStore((s) => s.clear);
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => rawItems.map(normalizeCartItem), [rawItems, tick]);

  const active = items.filter((i) => secondsUntil(i.expiresAt) > 0);
  const expired = items.filter((i) => secondsUntil(i.expiresAt) <= 0);
  const listSubtotal = active.reduce((s, i) => s + itemSubtotal(i), 0);
  const seatCount = active.reduce((s, i) => s + i.seatCount, 0);
  const currency = active[0]?.currency || 'MXN';
  const soonest = active.reduce(
    (min, i) => Math.min(min, secondsUntil(i.expiresAt)),
    Number.POSITIVE_INFINITY,
  );

  // Precio final con cargos e IVA, ya en el carrito.
  //
  // Enseñar aquí un «estimado» de $800 y cobrar $1,044 al final es exactamente
  // lo que la ley mexicana no permite: el precio anunciado tiene que ser el que
  // se paga. `pricing/calculate-cart` es público y devuelve el desglose, así que
  // se pide por evento (el endpoint es de un solo evento) y se suma.
  const pricingKey = active
    .map((i) => `${i.eventId}:${pricingItemsFor(i).map((l) => `${l.offerId}x${l.quantity}`).join(',')}`)
    .join('|');
  const [pricingByEvent, setPricingByEvent] = useState<Record<string, CartPricing>>({});
  const [pricingLoading, setPricingLoading] = useState(false);

  useEffect(() => {
    const targets = active
      .map((item) => ({ eventId: item.eventId, items: pricingItemsFor(item) }))
      .filter((t) => t.items.length);
    if (!targets.length) {
      setPricingByEvent({});
      return;
    }
    const controller = new AbortController();
    setPricingLoading(true);
    void Promise.all(
      targets.map((t) =>
        fetchCartPricing(API, { eventId: t.eventId, items: t.items }, controller.signal).then(
          (data) => [t.eventId, data] as const,
        ),
      ),
    )
      .then((entries) => {
        if (controller.signal.aborted) return;
        const next: Record<string, CartPricing> = {};
        for (const [eventId, data] of entries) if (data) next[eventId] = data;
        setPricingByEvent(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });
    return () => controller.abort();
    // `pricingKey` resume qué se está cotizando; `active` cambia de identidad
    // cada segundo por el tick del temporizador y dispararía una petición por
    // segundo.
  }, [pricingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const priced = active.filter((i) => pricingByEvent[i.eventId]);
  const allPriced = priced.length === active.length && active.length > 0;
  const grandTotal = priced.reduce((s, i) => s + Number(pricingByEvent[i.eventId].total || 0), 0);
  const grandExtras = priced.reduce(
    (s, i) =>
      s +
      Number(pricingByEvent[i.eventId].fees || 0) +
      Number(pricingByEvent[i.eventId].taxes || 0),
    0,
  );

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Paso 1 de 3 · Reserva</p>
          <h1>Tu carrito</h1>
          <p className={styles.lead}>
            {items.length
              ? 'Tus asientos están en hold. Completa el pago antes de que expire el tiempo.'
              : 'Cuando elijas asientos, aparecerán aquí listos para pagar.'}
          </p>
        </header>

        {!items.length ? (
          <section className={styles.empty} aria-labelledby="cart-empty-title">
            <div className={styles.emptyArt} aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <EmptyState
              title="Carrito vacío"
              description="Explora la cartelera y asegura tus lugares con hold en vivo."
              action={
                <div className={styles.emptyActions}>
                  <Link href="/events" className={styles.primary}>
                    Ver eventos
                  </Link>
                  <Link href="/" className={styles.ghost}>
                    Ir al inicio
                  </Link>
                </div>
              }
            />
          </section>
        ) : (
          <div className={styles.grid}>
            <section className={styles.list} aria-label="Reservas en carrito">
              {active.map((item) => {
                const idx = rawItems.findIndex((r) => r.eventId === item.eventId);
                const sec = secondsUntil(item.expiresAt);
                const urgent = sec > 0 && sec < 120;
                const listPrice = itemSubtotal(item);
                const pricing = pricingByEvent[item.eventId];
                const itemCurrency = item.currency || currency;
                const seats = seatSummary(item);
                const zones = lineBreakdown(item);
                const when = fmtDate(item.startsAt);

                return (
                  <article key={item.eventId} className={styles.card}>
                    <div className={styles.cardTop}>
                      <div>
                        <p className={styles.kicker}>Hold activo</p>
                        <h2>
                          {item.slug ? (
                            <Link href={`/events/${item.slug}`}>{item.eventTitle}</Link>
                          ) : (
                            item.eventTitle
                          )}
                        </h2>
                        <p className={styles.meta}>
                          {[item.venueName, item.venueCity, when].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {/* `aria-live` en un número que cambia cada segundo satura
                          al lector de pantalla; el hito lo anuncia el checkout. */}
                      <div
                        className={`${styles.timer} ${urgent ? styles.timerUrgent : ''}`}
                        role="timer"
                        aria-label={`Tiempo restante de la reserva para ${item.eventTitle}`}
                      >
                        <span>Tiempo</span>
                        <strong>{formatCountdown(sec)}</strong>
                      </div>
                    </div>

                    <dl className={styles.facts}>
                      <div>
                        <dt>Boletos</dt>
                        <dd>
                          {item.seatCount} asiento{item.seatCount === 1 ? '' : 's'}
                        </dd>
                      </div>
                      {zones && (
                        <div>
                          <dt>Zonas</dt>
                          <dd>{zones}</dd>
                        </div>
                      )}
                      {seats && (
                        <div>
                          <dt>Asientos</dt>
                          <dd>{seats}</dd>
                        </div>
                      )}
                      {pricing ? (
                        <>
                          <div>
                            <dt>Precio de los boletos</dt>
                            <dd>{formatMoney(pricing.subtotal, itemCurrency)}</dd>
                          </div>
                          <div>
                            <dt>Cargo por servicio + IVA</dt>
                            <dd>
                              {formatMoney(
                                Number(pricing.fees || 0) + Number(pricing.taxes || 0),
                                itemCurrency,
                              )}
                            </dd>
                          </div>
                          {Number(pricing.discount) > 0 && (
                            <div>
                              <dt>Descuento</dt>
                              <dd>−{formatMoney(pricing.discount, itemCurrency)}</dd>
                            </div>
                          )}
                          <div className={styles.factTotal}>
                            <dt>Total a pagar</dt>
                            <dd>{formatMoney(pricing.total, itemCurrency)}</dd>
                          </div>
                        </>
                      ) : listPrice > 0 ? (
                        <div>
                          <dt>Precio de los boletos</dt>
                          <dd>
                            {formatMoney(listPrice, itemCurrency)}
                            <span className={styles.factNote}>
                              {pricingLoading
                                ? ' · calculando cargos e IVA…'
                                : ' · falta sumar cargos e IVA'}
                            </span>
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => goCheckout(router, item)}
                      >
                        Ir a pagar
                      </button>
                      {item.slug && (
                        <Link href={`/events/${item.slug}`} className={styles.ghost}>
                          Ver evento
                        </Link>
                      )}
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => {
                          if (idx < 0) return;
                          releaseHolds(item);
                          removeAt(idx);
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  </article>
                );
              })}

              {expired.length > 0 && (
                <div className={styles.expiredBlock}>
                  <h3>Reservas expiradas</h3>
                  <p>El hold se liberó. Vuelve al mapa para elegir de nuevo.</p>
                  <ul>
                    {expired.map((item) => {
                      const idx = rawItems.findIndex((r) => r.eventId === item.eventId);
                      return (
                        <li key={`exp-${item.eventId}`}>
                          <span>{item.eventTitle}</span>
                          <div>
                            {item.slug && (
                              <Link href={`/events/${item.slug}`}>Reelegir</Link>
                            )}
                            <button type="button" onClick={() => idx >= 0 && removeAt(idx)}>
                              Limpiar
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <aside className={styles.summary} aria-label="Resumen">
              <h2>Resumen</h2>
              <ul className={styles.summaryRows}>
                <li>
                  <span>Eventos activos</span>
                  <strong>{active.length}</strong>
                </li>
                <li>
                  <span>Asientos</span>
                  <strong>{seatCount}</strong>
                </li>
                {Number.isFinite(soonest) && soonest < Number.POSITIVE_INFINITY && (
                  <li>
                    <span>Expira en</span>
                    <strong className={soonest < 120 ? styles.warn : undefined}>
                      {formatCountdown(soonest)}
                    </strong>
                  </li>
                )}
                {allPriced && grandExtras > 0 && (
                  <li>
                    <span>Cargo por servicio + IVA</span>
                    <strong>{formatMoney(grandExtras, currency)}</strong>
                  </li>
                )}
                {allPriced ? (
                  <li className={styles.totalRow}>
                    <span>Total a pagar</span>
                    <strong>{formatMoney(grandTotal, currency)}</strong>
                  </li>
                ) : listSubtotal > 0 ? (
                  <li className={styles.totalRow}>
                    <span>Precio de los boletos</span>
                    <strong>{formatMoney(listSubtotal, currency)}</strong>
                  </li>
                ) : null}
              </ul>

              <p className={styles.hint}>
                {allPriced
                  ? 'Precio final: ya incluye cargo por servicio e IVA. Es el mismo importe que verás al pagar.'
                  : pricingLoading
                    ? 'Calculando el total con cargo por servicio e IVA…'
                    : 'El total con cargo por servicio e IVA se muestra en el checkout, antes de cualquier cobro.'}
              </p>

              {active.length === 1 ? (
                <button
                  type="button"
                  className={styles.primaryWide}
                  onClick={() => goCheckout(router, active[0])}
                >
                  Continuar al pago
                </button>
              ) : active.length > 1 ? (
                <p className={styles.multiNote}>
                  Paga cada evento por separado para mantener el hold correcto.
                </p>
              ) : null}

              <div className={styles.trust}>
                <span>Boletos oficiales</span>
                <span>Hold en vivo</span>
                <span>Pago Banorte</span>
              </div>
              <p className={styles.hint}>
                Sin credenciales Banorte el checkout opera en modo demo (sin cargo real).
              </p>

              <div className={styles.summaryFooter}>
                <Link href="/events">Seguir explorando</Link>
                <button
                  type="button"
                  onClick={() => {
                    // Solo los activos: los expirados ya los soltó el worker.
                    active.forEach(releaseHolds);
                    clear();
                  }}
                >
                  Vaciar carrito
                </button>
              </div>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
