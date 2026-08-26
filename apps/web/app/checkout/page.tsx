'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { EventPosterArt } from '@/components/EventPosterArt';
import { HoldCountdown } from '@/components/HoldCountdown';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, getStoredUser } from '@/lib/auth';
import { checkoutFingerprint, clearCheckoutAttempt, getCheckoutIdempotencyKey } from '@/lib/checkout-attempt';
import { useCartStore } from '@/lib/cart-store';
import { orderPath, saveOrderAccessToken } from '@/lib/order-access';
import { isDeferredMethod, paymentWindowNotice, type PaymentMethodId } from '@/lib/payment-window';
import {
  fetchCartPricing,
  formatMoney,
  pricingTotal,
  sameTotal,
  type CartPricing,
} from '@/lib/pricing';
import { clearAffiliateRef, getAffiliateRefForEvent } from '@/lib/affiliate-ref';
import styles from './checkout.module.scss';

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
};

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
const HOLD_WARN_SECONDS = 120;

type FieldErrors = { name?: string; email?: string; phone?: string };

function validate(name: string, email: string, phone: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) errors.name = 'Escribe el nombre de quien recibe los boletos.';
  else if (name.trim().length > 120) errors.name = 'El nombre no puede pasar de 120 caracteres.';

  const cleanEmail = email.trim();
  if (!cleanEmail) errors.email = 'Necesitamos tu correo para enviarte los boletos y el acceso a la orden.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail))
    errors.email = 'Ese correo no parece válido. Revisa que tenga el formato nombre@dominio.com.';

  const cleanPhone = phone.replace(/[\s()-]/g, '');
  if (cleanPhone && !/^\+?\d{10,15}$/.test(cleanPhone))
    errors.phone = 'Escribe 10 dígitos (o el número con lada internacional).';

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
  const currency = cartItem?.currency || 'MXN';

  const [holdExpired, setHoldExpired] = useState(false);
  const [holdWarning, setHoldWarning] = useState(false);
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

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const methodRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Prellenado desde la sesión: una sola vez al montar. Leerlo en cada render
  // (como antes) reescribía el campo en cada pulsación y el usuario no podía
  // corregir el nombre heredado de su cuenta.
  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) return;
    setName((current) => current || `${storedUser.firstName} ${storedUser.lastName}`.trim());
    setEmail((current) => current || storedUser.email);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatewayInfo | null) => setGatewayInfo(data))
      .catch(() => {});
    return () => controller.abort();
  }, []);

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
        setPromoMsg('Código inválido o expirado.');
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
    const next = (index + (forward ? 1 : -1) + METHODS.length) % METHODS.length;
    setMethod(METHODS[next].id);
    methodRefs.current[next]?.focus();
  }

  function handleHoldExpired() {
    setHoldExpired(true);
    setHoldWarning(false);
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
  const totalLabel = pricing ? formatMoney(total, currency) : null;
  const canPay = !loading && !holdExpired && holdIds.length > 0;
  const deferred = isDeferredMethod(method);
  const payLabel = priceChange
    ? `Confirmar y pagar ${formatMoney(priceChange.to, currency)}`
    : gatewayInfo?.demo
      ? `Simular pago${totalLabel ? ` ${totalLabel}` : ''}`
      : deferred
        ? `Generar referencia${totalLabel ? ` ${totalLabel}` : ''}`
        : `Pagar${totalLabel ? ` ${totalLabel}` : ''} con Banorte`;

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.steps} aria-label="Progreso de compra">
          <Link href="/cart" className={styles.stepDone}>
            1 Carrito
          </Link>
          <span className={styles.stepActive} aria-current="step">
            2 Pago
          </span>
          <span className={styles.stepTodo}>3 Boletos</span>
        </div>
        <div className={styles.stepTrack} aria-hidden="true">
          <span className={styles.stepProgress} />
        </div>

        <header className={styles.hero}>
          <Badge tone="accent" variant="soft" size="md">
            Paso 2 de 3 · Pago seguro
          </Badge>
          <h1>Checkout</h1>
          <p>
            {gatewayInfo?.demo
              ? `Modo demo · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'}`
              : `Pago Banorte · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'}`}
          </p>
        </header>

        <HoldCountdown
          expiresAt={expiresAt}
          variant="hold"
          warnSeconds={HOLD_WARN_SECONDS}
          onWarn={() => setHoldWarning(true)}
          onExpire={handleHoldExpired}
          hint={
            deferred
              ? 'Tiempo para confirmar. Al generar la referencia ampliamos el apartado.'
              : 'Completa el pago antes de que expire'
          }
        />

        {holdWarning && !holdExpired && (
          <p className={styles.warn} role="status">
            Tu reserva está por expirar. Termina el pago o tendrás que elegir asientos otra vez.
          </p>
        )}

        {holdExpired && (
          <p className={styles.error} role="alert">
            Tu reserva expiró y los lugares volvieron a la venta. No se realizó ningún cargo.{' '}
            <Link href={cartItem?.slug ? `/events/${cartItem.slug}` : '/events'}>
              Volver a elegir asientos
            </Link>
          </p>
        )}

        <div className={styles.layout}>
          <Card className={styles.formCol} variant="elevated" padding="md" aria-label="Datos de pago">
            <div className={styles.trust}>
              <Badge tone="success" variant="soft" size="sm">
                Boletos oficiales
              </Badge>
              <Badge tone={gatewayInfo?.demo ? 'warning' : 'info'} variant="soft" size="sm">
                {gatewayInfo?.demo ? 'Demo' : 'Banorte'}
              </Badge>
              <Badge tone="neutral" variant="soft" size="sm">
                QR de acceso
              </Badge>
            </div>

            {gatewayInfo && (
              <div
                className={`${styles.banorteNote} ${gatewayInfo.demo ? styles.banorteDemo : ''}`}
                role={gatewayInfo.demo ? 'status' : undefined}
              >
                <strong>
                  {gatewayInfo.demo ? 'Modo demostración' : 'Pago procesado por Banorte'}
                </strong>
                <p>
                  {gatewayInfo.buyerNote ?? gatewayInfo.settlement}
                  {gatewayInfo.accountClabeMasked
                    ? ` · CLABE ${gatewayInfo.accountClabeMasked}`
                    : ''}
                </p>
                {!gatewayInfo.demo && (
                  <p className={styles.banorteTrust}>
                    El cobro va directo a la cuenta del organizador. BOLETERA no retiene tu dinero.
                  </p>
                )}
              </div>
            )}

            <div className={styles.fieldGrid}>
              <Input
                ref={nameRef}
                label="Nombre completo"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (showErrors) setFieldErrors(validate(e.target.value, email, phone));
                }}
                autoComplete="name"
                inputMode="text"
                enterKeyHint="next"
                required
                requiredMark
                error={showErrors ? fieldErrors.name : undefined}
                hint={
                  showErrors && fieldErrors.name
                    ? undefined
                    : 'Como aparece en tu identificación, por si la piden en el acceso.'
                }
              />

              <Input
                ref={emailRef}
                label="Correo electrónico"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (showErrors) setFieldErrors(validate(name, e.target.value, phone));
                }}
                autoComplete="email"
                inputMode="email"
                enterKeyHint="next"
                required
                requiredMark
                error={showErrors ? fieldErrors.email : undefined}
                hint={
                  showErrors && fieldErrors.email
                    ? undefined
                    : 'Ahí enviamos tus boletos y el enlace para consultarlos desde cualquier dispositivo.'
                }
              />

              <Input
                ref={phoneRef}
                label="Teléfono (opcional)"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (showErrors) setFieldErrors(validate(name, email, e.target.value));
                }}
                autoComplete="tel"
                inputMode="tel"
                enterKeyHint="done"
                error={showErrors ? fieldErrors.phone : undefined}
                hint={
                  showErrors && fieldErrors.phone
                    ? undefined
                    : 'Solo para avisarte si hay un cambio en el evento.'
                }
                className={styles.phoneField}
              />
            </div>

            <Input
              label="Código promocional"
              value={promo}
              onChange={(e) => {
                setPromo(e.target.value);
                setPromoValid(false);
                setPromoMsg(null);
              }}
              placeholder="Opcional"
              autoComplete="off"
              autoCapitalize="characters"
              hint={promoMsg ?? (promoValid ? 'Código aplicado.' : 'Si tienes un código, aplícalo antes de pagar.')}
              error={promoMsg && !promoValid ? promoMsg : undefined}
              trailing={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void validatePromo()}
                  disabled={!promo.trim() || promoChecking}
                  loading={promoChecking}
                  loadingLabel="…"
                >
                  Validar
                </Button>
              }
            />
            {promoValid && promoMsg ? (
              <p className={styles.promoOk} role="status">
                {promoMsg}
              </p>
            ) : null}

            <fieldset className={styles.methods}>
              <legend>Método de pago</legend>
              <div className={styles.methodGrid} role="radiogroup" aria-label="Método de pago">
                {METHODS.map((m, index) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    // Roving tabindex: el grupo entero es una sola parada de
                    // tabulación y las flechas mueven la selección.
                    tabIndex={method === m.id ? 0 : -1}
                    ref={(el) => {
                      methodRefs.current[index] = el;
                    }}
                    onKeyDown={(e) => onMethodKeyDown(e, index)}
                    className={`${styles.methodCard} ${method === m.id ? styles.methodOn : ''}`}
                    onClick={() => setMethod(m.id)}
                  >
                    <strong>{m.label}</strong>
                    <span>
                      {gatewayInfo?.demo && m.id === 'CARD'
                        ? 'Simulación local · sin cargo real'
                        : m.detail}
                    </span>
                  </button>
                ))}
              </div>
              <p className={styles.methodNote} role="status">
                {paymentWindowNotice(method)}
              </p>
            </fieldset>

            {priceChange && (
              <div className={styles.priceChange} role="alert">
                <strong>El total cambió antes de cobrar</strong>
                <p>
                  Pasó de {formatMoney(priceChange.from, currency)} a{' '}
                  {formatMoney(priceChange.to, currency)}. Revísalo y confirma si quieres continuar:
                  no cobramos nada hasta que lo apruebes.
                </p>
              </div>
            )}

            {failure && (
              <div className={styles.error} role="alert">
                <p>{failure.message}</p>
                {failure.needsNewHold && (
                  <Link href={cartItem?.slug ? `/events/${cartItem.slug}` : '/events'}>
                    Volver a elegir asientos
                  </Link>
                )}
                {failure.kind === 'credential' && !failure.needsNewHold && (
                  <Link href="/login">Iniciar sesión</Link>
                )}
              </div>
            )}

            <Button
              type="button"
              size="lg"
              fullWidth
              disabled={!canPay}
              loading={loading}
              loadingLabel="Procesando…"
              onClick={() => void pay()}
            >
              {payLabel}
            </Button>

            <p className={styles.fine}>
              Al continuar aceptas los <Link href="/terminos">términos</Link> y el{' '}
              <Link href="/privacidad">aviso de privacidad</Link>.
            </p>
          </Card>

          <aside className={styles.summaryCol} aria-label="Resumen del pedido">
            {cartItem ? (
              <Card className={styles.lineItems} variant="elevated" padding="md">
                <div className={styles.orderHeader}>
                  {cartItem.slug && (
                    <div className={styles.orderPoster} aria-hidden="true">
                      <EventPosterArt
                        event={{
                          id: cartItem.eventId,
                          slug: cartItem.slug,
                          title: cartItem.eventTitle,
                          startsAt: cartItem.startsAt,
                        }}
                        size="sm"
                        showDate
                      />
                    </div>
                  )}
                  <div>
                    <Badge tone="neutral" variant="soft" size="sm">
                      Tu pedido
                    </Badge>
                    <h2>{cartItem.eventTitle}</h2>
                    {(cartItem.venueName || cartItem.startsAt) && (
                      <p className={styles.lineMeta}>
                        {cartItem.venueName}
                        {cartItem.venueCity ? ` · ${cartItem.venueCity}` : ''}
                        {cartItem.startsAt
                          ? ` · ${new Date(cartItem.startsAt).toLocaleString('es-MX', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
                {orderLines.length > 0 && (
                  <ul className={styles.zoneList}>
                    {orderLines.map((line) => (
                      <li key={line.offerId}>
                        <span>{line.offerName || 'Zona'}</span>
                        <em>×{line.holdIds.length || line.quantity || 1}</em>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className={styles.seatList}>
                  {(seatLabels.length
                    ? seatLabels
                    : Array.from({ length: holdIds.length }, (_, i) => `Boleto ${i + 1}`)
                  ).map((label, i) => (
                    <li key={`${label}-${i}`}>
                      <Badge tone="neutral" variant="outline" size="sm">
                        {label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Card className={styles.lineItems} variant="elevated" padding="md">
                <Badge tone="neutral" variant="soft" size="sm">
                  Tu pedido
                </Badge>
                <h2>{holdIds.length} boleto(s)</h2>
                <p className={styles.lineMeta}>Reserva desde hold activo</p>
              </Card>
            )}

            <Card className={styles.summary} variant="elevated" padding="md" aria-busy={pricingLoading}>
              {pricing ? (
                <>
                  <div>
                    <span>Precio de los boletos</span>
                    <strong>{formatMoney(pricing.subtotal, currency)}</strong>
                  </div>
                  <div>
                    <span>Cargo por servicio</span>
                    <strong>{formatMoney(pricing.fees, currency)}</strong>
                  </div>
                  <div>
                    <span>IVA</span>
                    <strong>{formatMoney(pricing.taxes, currency)}</strong>
                  </div>
                  {Number(pricing.discount) > 0 && (
                    <div>
                      <span>Descuento</span>
                      <strong>−{formatMoney(pricing.discount, currency)}</strong>
                    </div>
                  )}
                  <div className={styles.total}>
                    <span>Total a pagar</span>
                    <strong>{formatMoney(total, currency)}</strong>
                  </div>
                  <p className={styles.totalNote}>
                    Precio final: incluye cargo por servicio e IVA. Es el importe que se cobra.
                  </p>
                </>
              ) : (
                <p className={styles.totalNoteMuted}>
                  {pricingLoading ? 'Calculando el total con cargos e IVA…' : 'Total no disponible.'}
                </p>
              )}
            </Card>

            <Link href="/cart" className={styles.backCart}>
              ← Volver al carrito
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutForm />
    </Suspense>
  );
}
