'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardFooter, CardHeader, EmptyState } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { EventPosterArt } from '@/components/EventPosterArt';
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

function posterFor(item: CartItem) {
  return {
    id: item.eventId,
    slug: item.slug ?? item.eventId,
    title: item.eventTitle,
    startsAt: item.startsAt,
  };
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
        <nav className={styles.steps} aria-label="Progreso de compra">
          <span className={styles.stepActive} aria-current="step">
            1 Carrito
          </span>
          <span className={styles.stepTodo}>2 Pago</span>
          <span className={styles.stepTodo}>3 Boletos</span>
        </nav>

        <header className={styles.hero}>
          <Badge tone="accent" variant="soft" size="md">
            Paso 1 de 3 · Reserva
          </Badge>
          <h1>Tu carrito</h1>
          <p className={styles.lead}>
            {items.length
              ? 'Tus asientos están en hold. Completa el pago antes de que expire el tiempo.'
              : 'Cuando elijas asientos, aparecerán aquí listos para pagar.'}
          </p>
        </header>

        {!items.length ? (
          <Card className={styles.empty} variant="elevated" padding="lg">
            <EmptyState
              title="Carrito vacío"
              description="Explora la cartelera y asegura tus lugares con hold en vivo."
              action={
                <div className={styles.emptyActions}>
                  <Button onClick={() => router.push('/events')}>Ver eventos</Button>
                  <Button variant="outline" onClick={() => router.push('/')}>
                    Ir al inicio
                  </Button>
                </div>
              }
            />
          </Card>
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
                  <Card key={item.eventId} className={styles.card} variant="elevated" padding="none">
                    <div className={styles.cardInner}>
                      <div className={styles.posterThumb} aria-hidden="true">
                        <EventPosterArt event={posterFor(item)} size="sm" showDate />
                      </div>
                      <div className={styles.cardContent}>
                        <div className={styles.cardTop}>
                          <div>
                            <Badge tone="success" variant="soft" size="sm" dot>
                              Hold activo
                            </Badge>
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

                        <CardFooter className={styles.actions}>
                          <Button onClick={() => goCheckout(router, item)}>Ir a pagar</Button>
                          {item.slug && (
                            <Button variant="outline" onClick={() => router.push(`/events/${item.slug}`)}>
                              Ver evento
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => {
                              if (idx < 0) return;
                              releaseHolds(item);
                              removeAt(idx);
                            }}
                          >
                            Quitar
                          </Button>
                        </CardFooter>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {expired.length > 0 && (
                <Card className={styles.expiredBlock} variant="outline" padding="md">
                  <CardHeader
                    as="h3"
                    title="Reservas expiradas"
                    description="El hold se liberó. Vuelve al mapa para elegir de nuevo."
                  />
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
                </Card>
              )}
            </section>

            <aside className={styles.summary} aria-label="Resumen">
              <Card variant="elevated" padding="md" className={styles.summaryCard}>
                <CardHeader as="h2" title="Resumen" />
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
                  <Button fullWidth size="lg" onClick={() => goCheckout(router, active[0])}>
                    Continuar al pago
                  </Button>
                ) : active.length > 1 ? (
                  <p className={styles.multiNote}>
                    Paga cada evento por separado para mantener el hold correcto.
                  </p>
                ) : null}

                <div className={styles.trust}>
                  <Badge tone="success" variant="soft" size="sm">
                    Boletos oficiales
                  </Badge>
                  <Badge tone="warning" variant="soft" size="sm">
                    Hold en vivo
                  </Badge>
                  <Badge tone="info" variant="soft" size="sm">
                    Pago Banorte
                  </Badge>
                </div>
                <p className={styles.hint}>
                  Sin credenciales Banorte el checkout opera en modo demo (sin cargo real).
                </p>

                <div className={styles.summaryFooter}>
                  <Link href="/events">Seguir explorando</Link>
                  <button
                    type="button"
                    onClick={() => {
                      active.forEach(releaseHolds);
                      clear();
                    }}
                  >
                    Vaciar carrito
                  </button>
                </div>
              </Card>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
