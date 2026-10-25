'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Field, Money, NamedStatus, TicketButton, formatTicketAmount } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, getStoredUser } from '@/lib/auth';
import { checkoutFingerprint, clearCheckoutAttempt, getCheckoutIdempotencyKey } from '@/lib/checkout-attempt';
import { useCartStore } from '@/lib/cart-store';
import { orderPath, saveOrderAccessToken } from '@/lib/order-access';
import { formatCountdown, isDeferredMethod, secondsUntil, type PaymentMethodId } from '@/lib/payment-window';
import { releaseHolds } from '@/lib/release-holds';
import purchase from '@/components/purchase/purchase.module.scss';
import {
  fetchCartPricing,
  pricingTotal,
  sameTotal,
  type CartPricing,
} from '@/lib/pricing';
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

const METHODS: { id: PaymentMethodId; label: string; detail: string }[] = [
  {
    id: 'CARD',
    label: 'Tarjeta',
    detail: 'Visa / Mastercard · Payworks 3-D Secure',
  },
  {
    id: 'SPEI',
    label: 'SPEI',
    detail: 'Transferencia a CLABE Banorte del promotor',
  },
  {
    id: 'OXXO',
    label: 'OXXO',
    detail: 'Paga en tienda con referencia',
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
    [params],
  );
  const rawCart = useCartStore((s) => s.items.find((i) => i.eventId === eventId));
  const removeFromCart = useCartStore((s) => s.removeAt);
  const cartIndex = useCartStore((s) => s.items.findIndex((i) => i.eventId === eventId));

  const cartItem = rawCart
    ? {
        ...rawCart,
        lines:
          rawCart.lines?.length
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
  const orderLines =
    cartItem?.lines?.length
      ? cartItem.lines
      : offerId && urlHoldIds.length
        ? [{ offerId, holdIds: urlHoldIds, quantity: urlHoldIds.length, offerName: undefined, seatLabels: undefined }]
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
  const [method, setMethod] = useState<PaymentMethodId>('CARD');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<CartPricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  /** Total que el comprador tiene delante; nunca se cobra otro sin confirmar. */
  const [quotedTotal, setQuotedTotal] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ from: number; to: number } | null>(null);
  const [failure, setFailure] = useState<ApiErrorInfo | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [offered, setOffered] = useState<PaymentMethodId[] | null>(null);
  const [step, setStep] = useState<'apartado' | 'datos' | 'pago'>('apartado');
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
    [linesKey], // eslint-disable-line react-hooks/exhaustive-deps
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
      controller.signal,
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
          }),
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
    !loading && !expired && holdIds.length > 0 && step === 'pago' && offered != null && offered.includes(method);
  const deferred = isDeferredMethod(method);
  const payAmount = priceChange ? priceChange.to : total;
  const payLabel = deferred ? 'Generar referencia' : `Pagar ${formatTicketAmount(payAmount)}`;
  const moneyLines = pricing
    ? [
        { label: 'Base', amount: Number(pricing.subtotal) || 0 },
        { label: 'Cargo', amount: Number(pricing.fees) || 0 },
        { label: 'IVA', amount: Number(pricing.taxes) || 0 },
        ...(Number(pricing.discount) > 0
          ? [{ label: 'Descuento', amount: -Number(pricing.discount) }]
          : []),
      ]
    : undefined;
  const methodLine =
    method === 'SPEI'
      ? 'La referencia aparta los lugares hasta 12 horas. La hora exacta queda en la orden.'
      : method === 'OXXO'
        ? 'La referencia aparta los lugares hasta 24 horas. La hora exacta queda en la orden.'
        : 'El cargo es en el momento. El apartado sigue mientras se paga.';

  function goDatos() {
    if (expired) return;
    setStep('datos');
  }

  function goPago() {
    const errors = validate(name, email, phone);
    setFieldErrors(errors);
    setShowErrors(true);
    if (Object.keys(errors).length) {
      focusFirstError(errors);
      return;
    }
    if (expired) return;
    setStep('pago');
  }

  function dropHold() {
    releaseHolds(holdIds);
    if (cartIndex >= 0) removeFromCart(cartIndex);
    router.push(cartItem?.slug ? `/events/${cartItem.slug}` : '/');
  }

  const backHref = cartItem?.slug ? `/events/${cartItem.slug}` : '/';

  return (
    <>
      <SiteHeader />
      <main id="contenido" className={purchase.column}>
        <div className={purchase.stack}>
          <div className={purchase.chips}>
            <NamedStatus status="apartado" />
            <span className={purchase.clock}>{expired ? '0:00' : formatCountdown(remain)}</span>
          </div>
          <h1 className={purchase.title}>
            {step === 'apartado' ? 'Apartado' : step === 'datos' ? 'Datos' : 'Pago'}
          </h1>
          {cartItem ? <p className={purchase.lead}>{cartItem.eventTitle}</p> : null}
        </div>

        {expired ? (
          <div className={purchase.error} role="alert">
            <span>El apartado venció.</span>
            <span>Elige de nuevo.</span>
            {seatLabels.map((label) => (
              <span key={label} className={purchase.mono}>
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {step === 'apartado' ? (
          <ul className={purchase.seatList}>
            {(seatLabels.length ? seatLabels : holdIds).map((label, index) => (
              <li key={`${label}-${index}`}>
                <span className={purchase.mono}>{label}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {step === 'datos' ? (
          <div className={purchase.stack}>
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
              label="Teléfono"
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
            <p className={purchase.caption}>
              {promoValid && promo.trim()
                ? `Código · ${promo.trim().toUpperCase()}`
                : 'Código · ninguno'}
            </p>
            <Field
              label="Código"
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
          </div>
        ) : null}

        {step === 'pago' ? (
          <div className={purchase.stack}>
            {offered == null ? <p className={purchase.caption}>Cargando métodos.</p> : null}
            {offered != null && visibleMethods.length === 0 ? (
              <p className={purchase.caption}>No hay un método de pago para esta función.</p>
            ) : null}
            {visibleMethods.length > 0 ? (
            <div className={purchase.segment} role="radiogroup" aria-label="Método de pago">
              {visibleMethods.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={method === item.id}
                  tabIndex={method === item.id ? 0 : -1}
                  ref={(element) => {
                    methodRefs.current[index] = element;
                  }}
                  onKeyDown={(event) => onMethodKeyDown(event, index)}
                  aria-pressed={method === item.id}
                  onClick={() => setMethod(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            ) : null}
            {visibleMethods.some((item) => item.id === method) ? (
              <p className={purchase.lead}>{methodLine}</p>
            ) : null}
            {gatewayInfo?.demo ? (
              <p className={purchase.caption}>Pasarela en demostración. Este cargo no cobra.</p>
            ) : null}
            <p className={purchase.caption}>
              {promoValid && promo.trim()
                ? `Código · ${promo.trim().toUpperCase()}`
                : 'Código · ninguno'}
            </p>
            {priceChange ? <p className={purchase.lead}>El total cambió.</p> : null}
            {failure ? (
              <div className={purchase.error} role="alert">
                <span>
                  {failure.kind === 'network'
                    ? 'No se guardó. Revisa la conexión.'
                    : failure.message}
                </span>
                {failure.kind === 'network' ? (
                  <TicketButton type="button" variant="secondary" onClick={() => void pay()}>
                    Reintentar
                  </TicketButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={purchase.actions}>
          {step === 'apartado' ? (
            <TicketButton type="button" variant="secondary" onClick={dropHold}>
              Soltar apartado
            </TicketButton>
          ) : (
            <TicketButton
              type="button"
              variant="secondary"
              onClick={() => setStep(step === 'pago' ? 'datos' : 'apartado')}
            >
              Atrás
            </TicketButton>
          )}
          {step === 'apartado' ? (
            <Link href={backHref} className={purchase.link}>
              Volver a la zona
            </Link>
          ) : null}
        </div>
      </main>

      <div className={purchase.dock}>
        <div className={purchase.dockInner}>
          <p className={purchase.dockSummary}>
            {holdIds.length} {holdIds.length === 1 ? 'lugar' : 'lugares'}
          </p>
          <Money label="Total" amount={total} currency={Boolean(pricing)} lines={moneyLines} />
          {step === 'apartado' ? (
            <TicketButton type="button" disabled={expired || holdIds.length === 0} onClick={goDatos}>
              Escribir datos
            </TicketButton>
          ) : null}
          {step === 'datos' ? (
            <TicketButton type="button" disabled={expired} onClick={goPago}>
              Elegir pago
            </TicketButton>
          ) : null}
          {step === 'pago' ? (
            <TicketButton type="button" disabled={!canPay || !pricing || pricingLoading} onClick={() => void pay()}>
              {loading ? 'Pagando' : payLabel}
            </TicketButton>
          ) : null}
        </div>
      </div>
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
