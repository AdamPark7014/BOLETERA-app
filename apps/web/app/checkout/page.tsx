'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Field, StageArt, TicketState, formatTicketAmount } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { HoldStickyBar } from '@/components/HoldStickyBar';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, getStoredUser } from '@/lib/auth';
import {
  checkoutFingerprint,
  clearCheckoutAttempt,
  getCheckoutIdempotencyKey,
} from '@/lib/checkout-attempt';
import { useCartStore } from '@/lib/cart-store';
import { orderPath, saveOrderAccessToken } from '@/lib/order-access';
import {
  formatCountdown,
  isDeferredMethod,
  secondsUntil,
  type PaymentMethodId,
} from '@/lib/payment-window';
import { releaseHolds } from '@/lib/release-holds';
import { shortWhen } from '@/lib/event-display';
import styles from './checkout.module.scss';
import methodStyles from './checkout-methods.module.scss';
import { fetchCartPricing, pricingTotal, sameTotal, type CartPricing } from '@/lib/pricing';
import { clearAffiliateRef, getAffiliateRefForEvent } from '@/lib/affiliate-ref';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type PaymentAction = {
  gateway: string;
  intentId: string;
  redirectUrl?: string;
  reference?: string;
  metadata?: {
    type?: string;
    clabe?: string;
    concept?: string;
    demo?: boolean;
  };
  status: string;
};

type CreatedOrder = {
  publicId: string;
  /** Se entrega UNA sola vez, aquí. Es la credencial del comprador invitado. */
  accessToken?: string;
  totalAmount?: string;
  currency?: string;
  expiresAt?: string;
  paymentAction?: PaymentAction;
};

type GatewayInfo = {
  settlement: string;
  demo: boolean;
  mode?: 'demo' | 'live';
  productionReady?: boolean;
  buyerNote?: string;
  accountClabeMasked?: string | null;
  methods?: string[];
};

function isCheckoutMethod(value: unknown): value is PaymentMethodId {
  return value === 'CARD' || value === 'SPEI' || value === 'OXXO';
}

/** Sin lista, los tres de hoy. Una lista vacía es una organización que los apagó. */
function readOffered(data: GatewayInfo | null): PaymentMethodId[] {
  if (!data || !Array.isArray(data.methods)) return ['CARD', 'SPEI', 'OXXO'];
  return data.methods.filter(isCheckoutMethod);
}

const METHODS: { id: PaymentMethodId; label: string; detail: string; when: string }[] = [
  {
    id: 'CARD',
    label: 'Tarjeta de crédito o débito',
    detail: 'Visa o Mastercard · 3-D Secure',
    when: 'Al instante',
  },
  {
    id: 'SPEI',
    label: 'Transferencia SPEI',
    detail: 'A la CLABE Banorte del promotor',
    when: 'Hasta 12 h',
  },
  {
    id: 'OXXO',
    label: 'Efectivo en OXXO',
    detail: 'Paga en tienda con referencia',
    when: 'Hasta 24 h',
  },
];

/** Aviso de expiración con dos minutos de margen; suficiente para reaccionar. */
type FieldErrors = { name?: string; email?: string; phone?: string };

function validate(name: string, email: string, phone: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) errors.name = 'Escribe el nombre en el boleto.';
  else if (name.trim().length > 120) errors.name = 'El nombre no puede pasar de 120 caracteres.';

  const cleanEmail = email.trim();
  if (!cleanEmail) errors.email = 'Escribe el correo.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail))
    errors.email = 'Ese correo no parece válido.';

  const cleanPhone = phone.replace(/[\s()-]/g, '');
  if (cleanPhone && !/^\+?\d{10,15}$/.test(cleanPhone))
    errors.phone = 'Si trae teléfono, son 10 a 15 dígitos.';

  return errors;
}

function CheckoutForm() {
  const params = useSearchParams();
  const router = useRouter();
  const eventId = params.get('eventId') ?? '';
  const offerId = params.get('offerId') ?? '';
  const urlHoldIds = useMemo(
    () => (params.get('holdIds') ?? '').split(',').filter(Boolean),
    [params]
  );
  const rawCart = useCartStore((s) => s.items.find((i) => i.eventId === eventId));
  const removeFromCart = useCartStore((s) => s.removeAt);
  const cartIndex = useCartStore((s) => s.items.findIndex((i) => i.eventId === eventId));

  const cartItem = rawCart
    ? {
        ...rawCart,
        lines: rawCart.lines?.length
          ? rawCart.lines
          : rawCart.offerId && rawCart.holdIds
            ? [
                {
                  offerId: rawCart.offerId,
                  holdIds: rawCart.holdIds,
                  seatLabels: rawCart.seatLabels,
                  quantity: rawCart.holdIds.length,
                  lineTotal: rawCart.lineTotal,
                },
              ]
            : [],
      }
    : null;
  const orderLines = cartItem?.lines?.length
    ? cartItem.lines
    : offerId && urlHoldIds.length
      ? [
          {
            offerId,
            holdIds: urlHoldIds,
            quantity: urlHoldIds.length,
            offerName: undefined,
            seatLabels: undefined,
          },
        ]
      : [];
  const holdIds = orderLines.flatMap((l) => l.holdIds);
  const cartExpires = cartItem?.expiresAt;
  const expiresAt = params.get('expiresAt') || cartExpires || null;

  const [holdExpired, setHoldExpired] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoValid, setPromoValid] = useState(false);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethodId>('CARD');
  /** Meses sin intereses (solo tarjeta y total ≥ umbral). Viaja al PaymentIntent. */
  const [installments, setInstallments] = useState<number>(1);
  const [holdWarn, setHoldWarn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<CartPricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  /** Total que el comprador tiene delante; nunca se cobra otro sin confirmar. */
  const [quotedTotal, setQuotedTotal] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ from: number; to: number } | null>(null);
  const [failure, setFailure] = useState<ApiErrorInfo | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [offered, setOffered] = useState<PaymentMethodId[] | null>(null);
  const [eventImage, setEventImage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const methodRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Prellenado desde la sesión: una sola vez al montar. Leerlo en cada render
  // (como antes) reescribía el campo en cada pulsación y el usuario no podía
  // corregir el nombre heredado de su cuenta.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) return;
    setName((current) => current || `${storedUser.firstName} ${storedUser.lastName}`.trim());
    setEmail((current) => current || storedUser.email);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
    fetch(`${API}/payments/config${query}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatewayInfo | null) => {
        setGatewayInfo(data);
        setOffered(readOffered(data));
      })
      .catch(() => {
        if (!controller.signal.aborted) setOffered(['CARD', 'SPEI', 'OXXO']);
      });
    return () => controller.abort();
  }, [eventId]);

  // Miniatura del evento: el carrito no la guarda, la ficha pública sí.
  const cartSlug = rawCart?.slug;
  useEffect(() => {
    if (!cartSlug) return;
    const controller = new AbortController();
    fetch(`${API}/discovery/events/${encodeURIComponent(cartSlug)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { image?: string | null; bannerImage?: string | null } | null) => {
        if (data) setEventImage(data.image || data.bannerImage || null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [cartSlug]);

  useEffect(() => {
    if (!offered?.length || offered.includes(method)) return;
    setMethod(offered[0]);
  }, [offered, method]);

  const visibleMethods = METHODS.filter((item) => offered?.includes(item.id));

  const linesKey = orderLines.map((l) => `${l.offerId}:${l.holdIds.length}`).join('|');
  const pricingItems = useMemo(
    () =>
      orderLines.map((l) => ({
        offerId: l.offerId,
        quantity: l.holdIds.length || l.quantity || 1,
      })),
    // `linesKey` resume la forma del pedido; recalcular por identidad de array
    // dispararía una petición de precio en cada render.
    [linesKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Precio completo desde el primer render de esta pantalla: sin él, el
  // comprador solo vería el subtotal hasta después de teclear sus datos.
  useEffect(() => {
    if (!eventId || !pricingItems.length) return;
    const controller = new AbortController();
    setPricingLoading(true);
    fetchCartPricing(
      API,
      { eventId, items: pricingItems, promotionCode: promoValid ? promo : undefined },
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        setPricing(data);
        setQuotedTotal(pricingTotal(data));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });
    return () => controller.abort();
  }, [eventId, pricingItems, promo, promoValid]);

  async function validatePromo() {
    if (!promo.trim() || !eventId) return;
    setPromoMsg(null);
    setPromoChecking(true);
    try {
      const res = await fetch(`${API}/campaigns/validate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promo.trim(), eventId, userId: email.trim() || 'guest' }),
      });
      if (res.ok) {
        setPromoValid(true);
        setPromoMsg('Código aplicado. El total de abajo ya lo incluye.');
      } else {
        setPromoValid(false);
        setPromoMsg('Ese código no aplica a esta función.');
      }
    } catch {
      setPromoValid(false);
      setPromoMsg('No pudimos validar el código. Revisa tu conexión.');
    } finally {
      setPromoChecking(false);
    }
  }

  /** Lleva el foco al primer campo con error (WCAG 2.2: 3.3.1 / 3.3.3). */
  const focusFirstError = useCallback((errors: FieldErrors) => {
    if (errors.name) nameRef.current?.focus();
    else if (errors.email) emailRef.current?.focus();
    else if (errors.phone) phoneRef.current?.focus();
  }, []);

  /** Flechas dentro del radiogroup, como pide el patrón ARIA de radios. */
  function onMethodKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const next = (index + (forward ? 1 : -1) + visibleMethods.length) % visibleMethods.length;
    setMethod(visibleMethods[next].id);
    methodRefs.current[next]?.focus();
  }

  function handleHoldExpired() {
    setHoldExpired(true);
    // El hold ya no vale en el servidor: dejar la entrada en el carrito solo
    // sirve para que el comprador vuelva a chocar contra el mismo 400.
    if (cartIndex >= 0) removeFromCart(cartIndex);
  }

  async function pay() {
    const errors = validate(name, email, phone);
    setFieldErrors(errors);
    setShowErrors(true);
    if (Object.keys(errors).length) {
      focusFirstError(errors);
      return;
    }

    setLoading(true);
    setFailure(null);
    try {
      // Reconsulta del precio pegada al cobro: entre que se pintó el resumen y
      // este clic pudo cambiar el precio dinámico o caducar la promoción.
      // Cobrar un importe distinto del mostrado sin decirlo es lo que no se
      // puede hacer, así que se muestra el cambio y se exige un segundo clic.
      const fresh = await fetchCartPricing(API, {
        eventId,
        items: pricingItems,
        promotionCode: promoValid ? promo : undefined,
      });
      if (fresh) {
        const freshTotal = pricingTotal(fresh);
        // Con una confirmación pendiente, el importe aprobado es el de la
        // confirmación: si volvió a moverse entre los dos clics hay que
        // preguntar otra vez, no cobrar el tercero en silencio.
        const approved = priceChange ? priceChange.to : (quotedTotal ?? freshTotal);
        setPricing(fresh);
        setQuotedTotal(freshTotal);
        if (!sameTotal(approved, freshTotal)) {
          setPriceChange({ from: approved, to: freshTotal });
          setLoading(false);
          return;
        }
      }
      setPriceChange(null);

      const fingerprint = checkoutFingerprint({
        eventId,
        holdIds,
        paymentMethod: method,
        promotionCode: promoValid ? promo : undefined,
      });

      // Cuerpo estricto: el ValidationPipe rechaza con 400 cualquier campo no
      // declarado. `userId` sale del JWT, nunca de aquí. `items` gana sobre
      // `holdIds`/`offerId` en el servidor, así que se manda uno u otro.
      const multiLine = orderLines.length > 1;
      const body: Record<string, unknown> = {
        eventId,
        buyerName: name.trim(),
        buyerEmail: email.trim(),
        paymentMethod: method,
      };
      if (method === 'CARD' && installments > 1) {
        body.installments = installments;
      }
      if (multiLine) {
        body.items = orderLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds }));
      } else {
        body.holdIds = holdIds;
        const singleOffer = orderLines[0]?.offerId || offerId;
        if (singleOffer) body.offerId = singleOffer;
      }
      const cleanPhone = phone.replace(/[\s()-]/g, '');
      if (cleanPhone) body.buyerPhone = cleanPhone;
      if (promoValid && promo.trim()) body.promotionCode = promo.trim();
      const affiliateRef = getAffiliateRefForEvent(eventId);
      if (affiliateRef) body.affiliateRef = affiliateRef;

      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Estable por intento: un reintento tras un timeout devuelve la orden
          // ya creada en vez de cobrar dos veces.
          'Idempotency-Key': getCheckoutIdempotencyKey(fingerprint),
          ...authHeaders(),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const info = await readApiError(res, 'No se pudo crear la orden');
        setFailure(info);
        if (info.needsNewHold) handleHoldExpired();
        return;
      }

      const order = (await res.json()) as CreatedOrder;
      // El token vuelve una sola vez. Se archiva ANTES de navegar (o de saltar
      // a la pasarela, que vuelve por una URL que el banco compone y en la que
      // no cabe el token).
      saveOrderAccessToken(order.publicId, order.accessToken);
      clearCheckoutAttempt();
      clearAffiliateRef();

      const action = order.paymentAction;
      if (action?.redirectUrl) {
        window.location.href = action.redirectUrl;
        return;
      }

      if (action) {
        router.push(
          orderPath(order.publicId, order.accessToken, '/pago', {
            method,
            ref: action.reference ?? '',
            clabe: action.metadata?.clabe ?? '',
            concept: action.metadata?.concept ?? '',
          })
        );
        return;
      }

      router.push(orderPath(order.publicId, order.accessToken));
    } catch (e) {
      setFailure(networkError(e));
    } finally {
      setLoading(false);
    }
  }

  const seatLabels =
    cartItem?.lines?.flatMap((l) => l.seatLabels ?? []) ?? cartItem?.seatLabels ?? [];
  const total = quotedTotal ?? pricingTotal(pricing);
  const remain = secondsUntil(expiresAt);
  void tick;
  const expired = holdExpired || (Boolean(expiresAt) && remain <= 0);
  const canPay =
    !loading && !expired && holdIds.length > 0 && offered != null && offered.includes(method);
  const deferred = isDeferredMethod(method);
  const payAmount = priceChange ? priceChange.to : total;
  const payLabel = deferred ? 'Generar referencia' : `Pagar ${formatTicketAmount(payAmount)}`;
  const discount = pricing ? Number(pricing.discount) || 0 : 0;
  const ticketCount = holdIds.length;
  const when = cartItem?.startsAt ? shortWhen(cartItem.startsAt) : null;

  function dropHold() {
    releaseHolds(holdIds);
    if (cartIndex >= 0) removeFromCart(cartIndex);
    router.push(cartItem?.slug ? `/events/${cartItem.slug}` : '/');
  }

  const backHref = cartItem?.slug ? `/events/${cartItem.slug}` : '/';

  const payButton = (
    <button
      type="button"
      className={styles.payButton}
      disabled={!canPay || !pricing || pricingLoading}
      onClick={() => void pay()}
    >
      {loading ? 'Procesando…' : payLabel}
    </button>
  );

  // Sin apartado no hay nada que pagar: un estado claro con salida, nunca
  // un formulario con «Pagar $0.00».
  if (holdIds.length === 0) {
    return (
      <>
        <SiteHeader />
        <main id="contenido" tabIndex={-1} className={styles.page}>
          <TicketState
            title="No tienes un apartado activo"
            body="Elige tus asientos y aquí verás tu pago."
            minHeight={420}
            action={
              <Link href="/" className={styles.emptyAction}>
                Ver cartelera
              </Link>
            }
          />
        </main>
      </>
    );
  }

  const msiThreshold = 1500;
  const showMsi = method === 'CARD' && payAmount >= msiThreshold;
  const msiPlans = [1, 3, 6, 9, 12] as const;

  return (
    <>
      <SiteHeader compact />
      <HoldStickyBar
        expiresAt={expiresAt}
        onExpire={() => setHoldExpired(true)}
        onWarn={() => setHoldWarn(true)}
        warnSeconds={120}
      />
      <div className={styles.steps}>
        <div className={styles.stepsInner}>
          <Link href={backHref} className={styles.back} aria-label="Volver al mapa">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
          <ol className={styles.crumbs} aria-label="Pasos de la compra">
            <li>Asientos</li>
            <li aria-current="step">Pago</li>
            <li>Boletos</li>
          </ol>
          <span className={styles.clock} role="timer" aria-label="Tiempo de apartado">
            {expired ? '00:00' : formatCountdown(remain)}
          </span>
        </div>
      </div>

      <main id="contenido" tabIndex={-1} className={styles.page}>
        <h1 className="sr-only">Pago</h1>
        {holdWarn && !expired ? (
          <p className={styles.warn} role="status">
            Quedan menos de 2 minutos de apartado. Termina el pago o tus lugares se liberan.
          </p>
        ) : null}
        <div className={styles.grid}>
          <div className={styles.mainCol}>
            <section className={styles.eventCard} aria-label="Tu compra">
              <span className={styles.thumb}>
                {eventImage ? (
                  <Image src={eventImage} alt="" fill sizes="72px" className={styles.cover} />
                ) : (
                  <StageArt
                    seed={cartItem?.slug ?? eventId}
                    fade={false}
                    className={styles.cover}
                  />
                )}
              </span>
              <span className={styles.eventCopy}>
                <strong className={styles.eventTitle}>
                  {cartItem?.eventTitle ?? 'Tu apartado'}
                </strong>
                <span className={styles.muted}>
                  {[when, cartItem?.venueName].filter(Boolean).join(' · ')}
                </span>
                <span className={styles.seats}>
                  {ticketCount} {ticketCount === 1 ? 'boleto' : 'boletos'}
                  {seatLabels.length ? ` · ${seatLabels.join(', ')}` : ''}
                </span>
              </span>
            </section>

            {expired ? (
              <div className={styles.alert} role="alert">
                <strong>El apartado venció.</strong>
                <span>Tus lugares se liberaron. Vuelve al mapa y elige de nuevo.</span>
                <Link href={backHref} className={styles.alertLink}>
                  Volver al mapa
                </Link>
              </div>
            ) : null}

            <section className={styles.block} aria-labelledby="datos-title">
              <h2 className={styles.label} id="datos-title">
                Tus datos
              </h2>
              <Field
                ref={nameRef}
                label="Nombre en el boleto"
                value={name}
                autoComplete="name"
                onChange={(event) => {
                  setName(event.target.value);
                  if (showErrors) setFieldErrors(validate(event.target.value, email, phone));
                }}
                error={showErrors ? fieldErrors.name : undefined}
              />
              <Field
                ref={emailRef}
                label="Correo"
                type="email"
                value={email}
                autoComplete="email"
                placeholder="nombre@dominio.com"
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (showErrors) setFieldErrors(validate(name, event.target.value, phone));
                }}
                error={showErrors ? fieldErrors.email : undefined}
              />
              <Field
                ref={phoneRef}
                label="Teléfono (opcional)"
                type="tel"
                value={phone}
                autoComplete="tel"
                placeholder="10 dígitos"
                onChange={(event) => {
                  setPhone(event.target.value);
                  if (showErrors) setFieldErrors(validate(name, email, event.target.value));
                }}
                error={showErrors ? fieldErrors.phone : undefined}
              />
              {!promoOpen && !promoValid ? (
                <button
                  type="button"
                  className={styles.promoToggle}
                  onClick={() => setPromoOpen(true)}
                >
                  ¿Tienes un código?
                </button>
              ) : null}
              {promoOpen || promoValid ? (
                <div className={styles.promo}>
                  <Field
                    label="Código de descuento"
                    value={promo}
                    disabled={promoChecking}
                    autoComplete="off"
                    onChange={(event) => {
                      setPromo(event.target.value);
                      setPromoValid(false);
                      setPromoMsg(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void validatePromo();
                      }
                    }}
                    error={promoMsg && !promoValid ? promoMsg : undefined}
                  />
                  <button
                    type="button"
                    className={styles.apply}
                    disabled={!promo.trim() || promoChecking}
                    onClick={() => void validatePromo()}
                  >
                    {promoChecking ? 'Validando…' : 'Aplicar'}
                  </button>
                </div>
              ) : null}
              {promoValid && promoMsg ? (
                <p className={styles.ok} role="status">
                  {promoMsg}
                </p>
              ) : null}
            </section>

            <section className={styles.block} aria-labelledby="pago-title">
              <h2 className={styles.label} id="pago-title">
                Pago
              </h2>
              {offered == null ? (
                <div className={styles.methodsSkeleton} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {offered != null && visibleMethods.length === 0 ? (
                <p className={styles.muted}>
                  No hay un método de pago disponible para esta función.
                </p>
              ) : null}
              {visibleMethods.length > 0 ? (
                <div className={methodStyles.methods} role="radiogroup" aria-label="Método de pago">
                  {visibleMethods.map((item, index) => {
                    const active = method === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                        ref={(element) => {
                          methodRefs.current[index] = element;
                        }}
                        onKeyDown={(event) => onMethodKeyDown(event, index)}
                        onClick={() => setMethod(item.id)}
                        className={methodStyles.method}
                      >
                        <span className={styles.radio} aria-hidden="true" />
                        <span className={methodStyles.methodCopy}>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <span className={methodStyles.methodWhen}>{item.when}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {gatewayInfo?.demo ? (
                <p className={styles.demo}>Modo demostración: no se hace ningún cargo.</p>
              ) : null}
              {showMsi ? (
                <div className={styles.msi} role="group" aria-label="Meses sin intereses">
                  <p className={styles.label}>Meses sin intereses</p>
                  <div className={styles.msiPlans}>
                    {msiPlans.map((plan) => {
                      const perMonth = payAmount / plan;
                      const active = installments === plan;
                      return (
                        <button
                          key={plan}
                          type="button"
                          className={styles.msiPlan}
                          aria-pressed={active}
                          onClick={() => setInstallments(plan)}
                        >
                          <strong>{plan === 1 ? 'De contado' : `${plan} meses`}</strong>
                          <span>
                            {plan === 1
                              ? formatTicketAmount(payAmount)
                              : `${formatTicketAmount(perMonth)} / mes`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className={styles.muted}>
                    El plan se guarda con tu pago. Si el banco no ofrece MSI en este comercio, se
                    cobra de contado.
                  </p>
                </div>
              ) : null}
            </section>
          </div>

          <aside className={styles.sideCol} aria-label="Resumen del pago">
            <section className={styles.breakdown}>
              <div className={styles.row}>
                <span className={styles.muted}>
                  {ticketCount} {ticketCount === 1 ? 'boleto' : 'boletos'}
                </span>
                <span className={styles.num}>
                  {pricing ? formatTicketAmount(total + discount) : '…'}
                </span>
              </div>
              {discount > 0 ? (
                <div className={styles.row}>
                  <span className={styles.muted}>
                    Descuento{promo.trim() ? ` · ${promo.trim().toUpperCase()}` : ''}
                  </span>
                  <span className={styles.num}>−{formatTicketAmount(discount)}</span>
                </div>
              ) : null}
              <div className={styles.totalRow}>
                <span>
                  Total
                  <small>Incluye cargos e IVA</small>
                </span>
                <strong aria-live="polite">{pricing ? formatTicketAmount(payAmount) : '…'}</strong>
              </div>
              {pricing ? (
                <details className={styles.details}>
                  <summary>Ver desglose</summary>
                  <div className={styles.row}>
                    <span className={styles.muted}>Precio base</span>
                    <span className={styles.num}>
                      {formatTicketAmount(Number(pricing.subtotal) || 0)}
                    </span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.muted}>Cargo por servicio</span>
                    <span className={styles.num}>
                      {formatTicketAmount(Number(pricing.fees) || 0)}
                    </span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.muted}>IVA</span>
                    <span className={styles.num}>
                      {formatTicketAmount(Number(pricing.taxes) || 0)}
                    </span>
                  </div>
                </details>
              ) : null}
            </section>

            {priceChange ? (
              <p className={styles.warn} role="status">
                El total cambió de {formatTicketAmount(priceChange.from)} a{' '}
                {formatTicketAmount(priceChange.to)}. Toca pagar otra vez para confirmar.
              </p>
            ) : null}
            {failure ? (
              <div className={styles.alert} role="alert">
                <span>
                  {failure.kind === 'network'
                    ? 'No se guardó. Revisa la conexión.'
                    : failure.message}
                </span>
                {failure.kind === 'network' ? (
                  <button type="button" className={styles.alertLink} onClick={() => void pay()}>
                    Reintentar
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={styles.payDock}>
              {payButton}
              <span className={styles.terms}>
                Al pagar aceptas los <Link href="/terminos">términos</Link> y la{' '}
                <Link href="/terminos#reembolsos">política de reembolso</Link>.
              </span>
            </div>

            <button type="button" className={styles.drop} onClick={dropHold}>
              Cancelar y liberar asientos
            </button>
          </aside>
        </div>
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutForm />
    </Suspense>
  );
}
