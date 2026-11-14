'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { NamedStatus, TicketButton } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, clearSession, getToken } from '@/lib/auth';
import { formatDeadline } from '@/lib/payment-window';
import { formatMoney } from '@/lib/pricing';
import purchase from '@/components/purchase/purchase.module.scss';
import styles from '../../membresias.module.scss';
import { periodLabel, type CheckoutStatus } from '../../types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

const METHOD_LABEL: Record<string, string> = { CARD: 'Tarjeta', SPEI: 'SPEI', OXXO: 'OXXO' };

/** Valor en mono con su botón de copiar (CLABE, concepto, referencia). */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={styles.copyValue}>
      <span>{value}</span>
      <button
        type="button"
        className={purchase.link}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value.replace(/\s/g, ''))
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {});
        }}
      >
        {copied ? 'Copiado' : `Copiar ${label}`}
      </button>
    </span>
  );
}

/**
 * Pago de una membresía. El cobro es el de las órdenes: aquí se lee el estado
 * de la compra y se espera la confirmación (IPN Banorte, o la simulación en
 * demo). Confirmado, se vuelve a la cuenta, donde ya aparece «Mi membresía».
 */
export default function MembresiaPagoPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const router = useRouter();
  const [checkout, setCheckout] = useState<CheckoutStatus | null>(null);
  const [loadError, setLoadError] = useState<ApiErrorInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [gatewayDemo, setGatewayDemo] = useState(false);

  const load = useCallback(async () => {
    if (!publicId) return null;
    try {
      const res = await fetch(`${API}/memberships/checkout/${encodeURIComponent(publicId)}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (res.status === 401) {
        clearSession();
        router.replace(`/login?next=${encodeURIComponent(`/membresias/pago/${publicId}`)}`);
        return null;
      }
      if (res.status === 404) {
        setNotFound(true);
        return null;
      }
      if (!res.ok) {
        setLoadError(await readApiError(res, 'No pudimos leer tu compra'));
        return null;
      }
      const data = (await res.json()) as CheckoutStatus;
      setCheckout(data);
      setLoadError(null);
      if (data.status === 'COMPLETED') router.replace('/cuenta?membresia=activa');
      return data;
    } catch (e) {
      setLoadError(networkError(e));
      return null;
    }
  }, [publicId, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(`/membresias/pago/${publicId}`)}`);
      return;
    }
    void load();
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => setGatewayDemo(Boolean(cfg?.demo)))
      .catch(() => {});
    return () => controller.abort();
  }, [load, publicId, router]);

  // Mientras siga pendiente se sondea: el IPN puede tardar (OXXO, horas).
  const pending = checkout?.status === 'PENDING';
  useEffect(() => {
    if (!pending) return;
    const poll = setInterval(() => void load(), 4000);
    return () => clearInterval(poll);
  }, [pending, load]);

  /** Solo demo: la misma confirmación manual que usan las órdenes. */
  async function simulate() {
    if (!checkout) return;
    setSimulating(true);
    setSimError(null);
    try {
      const res = await fetch(`${API}/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          orderId: checkout.id,
          externalId: `banorte_demo_${checkout.publicId}`,
        }),
      });
      if (!res.ok) {
        const info = await readApiError(res, 'No se pudo simular el pago');
        setSimError(info.message);
        return;
      }
      await load();
    } catch (e) {
      setSimError(networkError(e).message);
    } finally {
      setSimulating(false);
    }
  }

  const method = (checkout?.paymentMethod ?? 'CARD').toUpperCase();
  const deferred = method === 'SPEI' || method === 'OXXO';
  const demo = gatewayDemo || checkout?.payment.demo === true;

  return (
    <>
      <SiteHeader />
      <main id="contenido" className={purchase.column}>
        <div className={purchase.stack}>
          <div className={purchase.chips}>
            <NamedStatus status={checkout?.status === 'COMPLETED' ? 'cobrado' : 'pendiente'} />
            {checkout ? <span className={purchase.clock}>{checkout.publicId}</span> : null}
          </div>
          <h1 className={purchase.title}>Pago de membresía</h1>
          {checkout ? (
            <p className={purchase.lead}>
              {checkout.planName}
              {checkout.billingPeriod ? ` · ${periodLabel(checkout.billingPeriod)}` : ''}
              {checkout.kind === 'RENEWAL' ? ' · Renovación' : ''}
            </p>
          ) : null}
        </div>

        {notFound ? (
          <div className={purchase.error} role="alert">
            <span>No encontramos esta compra en tu cuenta.</span>
            <Link href="/membresias" className={purchase.link}>
              Ver planes
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
          <dl className={styles.facts}>
            <div>
              <dt>Método</dt>
              <dd>{METHOD_LABEL[method] ?? method}</dd>
            </div>
            <div>
              <dt>Importe exacto</dt>
              <dd>{formatMoney(checkout.amount, checkout.currency)}</dd>
            </div>
            <div>
              <dt>Paga antes de</dt>
              <dd>{formatDeadline(checkout.expiresAt) || '—'}</dd>
            </div>
            {pending && deferred && checkout.payment.clabe ? (
              <div>
                <dt>CLABE</dt>
                <dd>
                  <CopyValue value={checkout.payment.clabe} label="CLABE" />
                </dd>
              </div>
            ) : null}
            {pending && deferred && (checkout.payment.concept || checkout.payment.reference) ? (
              <div>
                <dt>{method === 'SPEI' ? 'Concepto' : 'Referencia OXXO'}</dt>
                <dd>
                  <CopyValue
                    value={
                      (method === 'SPEI'
                        ? checkout.payment.concept || checkout.payment.reference
                        : checkout.payment.reference || checkout.payment.concept) ?? ''
                    }
                    label={method === 'SPEI' ? 'concepto' : 'referencia'}
                  />
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {checkout && pending && deferred ? (
          <p className={purchase.lead} aria-live="polite">
            {method === 'SPEI'
              ? 'Transfiere el importe exacto desde la app de tu banco con esta CLABE y concepto. La membresía se activa sola cuando el banco acredita el pago.'
              : 'Paga el importe exacto en cualquier OXXO con esta referencia. La membresía se activa sola cuando se acredita el pago.'}
            {demo ? ' Modo demo: datos de prueba, no transfieras dinero real.' : ''}
          </p>
        ) : null}

        {checkout && pending && !deferred ? (
          <p className={purchase.lead} aria-live="polite">
            {demo
              ? 'Pasarela en demostración: el cargo no cobra. Simula la confirmación del banco para activar tu membresía.'
              : 'Esperando la confirmación del banco (IPN Banorte). No vuelvas a pagar: en cuanto llegue te llevamos a tu cuenta.'}
          </p>
        ) : null}

        {checkout && pending && demo ? (
          <div className={purchase.stack}>
            <TicketButton
              type="button"
              variant="secondary"
              onClick={() => void simulate()}
              disabled={simulating}
            >
              {simulating ? 'Simulando' : 'Simular pago (demo)'}
            </TicketButton>
            {simError ? (
              <div className={purchase.error} role="alert">
                <span>{simError}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {checkout && checkout.status === 'FAILED' ? (
          <div className={purchase.error} role="alert">
            <span>El banco rechazó el pago. No se hizo ningún cargo.</span>
            <Link href="/membresias" className={purchase.link}>
              Intentar de nuevo
            </Link>
          </div>
        ) : null}

        {checkout && checkout.status === 'PENDING_REFUND' ? (
          <div className={purchase.error} role="alert">
            <span>
              El cobro entró pero no pudimos activar la membresía (el plan se llenó o cambió). Te
              devolvemos el dinero; te escribimos por correo.
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
