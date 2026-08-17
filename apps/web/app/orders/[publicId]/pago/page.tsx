'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import {
  ORDER_TOKEN_PARAM,
  fetchOrderResource,
  orderPath,
  resolveOrderAccessToken,
} from '@/lib/order-access';
import { DeferredPaymentPanel } from '../DeferredPaymentPanel';
import { OrderAccessGate } from '../OrderAccessGate';
import styles from '../order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

type OrderMeta = {
  id?: string;
  status?: string;
  totalAmount?: string;
  currency?: string;
  paymentMethod?: string | null;
  /** Fecha límite real; para OXXO/SPEI son horas, no los 15 min del hold. */
  expiresAt?: string | null;
  pendingPayment?: {
    reference?: string | null;
    metadata?: { clabe?: string; concept?: string; reference?: string; demo?: boolean } | null;
  } | null;
};

function PagoContent() {
  const { publicId } = useParams<{ publicId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const result = search.get('result');
  const methodParam = (search.get('method') ?? 'CARD').toUpperCase();
  const ref = search.get('ref') ?? '';
  const clabeParam = search.get('clabe') ?? '';
  const conceptParam = search.get('concept') ?? '';
  const demo = search.get('demo') === '1';
  const urlToken = search.get(ORDER_TOKEN_PARAM) ?? undefined;

  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<ApiErrorInfo | null>(null);
  const [denied, setDenied] = useState<'forbidden' | 'not-found' | null>(null);
  const [gatewayDemo, setGatewayDemo] = useState(demo);
  const [orderMeta, setOrderMeta] = useState<OrderMeta | null>(null);

  useEffect(() => {
    if (!publicId) return;
    setToken(resolveOrderAccessToken(publicId, urlToken));
    setTokenReady(true);
  }, [publicId, urlToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => {
        if (cfg?.demo) setGatewayDemo(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  /** Lectura de la orden con la credencial que haya (token del correo o JWT). */
  const loadOrder = useCallback(async () => {
    if (!publicId) return null;
    const res = await fetchOrderResource<OrderMeta>(API, publicId, '', token);
    if (res.ok) {
      setOrderMeta(res.data);
      setDenied(null);
      return res.data;
    }
    if (res.forbidden) setDenied('forbidden');
    else if (res.notFound) setDenied('not-found');
    return null;
  }, [publicId, token]);

  useEffect(() => {
    if (!tokenReady) return;
    void loadOrder();
  }, [tokenReady, loadOrder]);

  // Vuelta desde la pasarela. En demo confirmamos nosotros; en real, esperamos
  // al IPN de Banorte sondeando el estado público (que ya no trae importes).
  useEffect(() => {
    if (result !== 'ok' || !publicId || !tokenReady) return;

    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    async function confirmDemo() {
      setConfirming(true);
      setFailure(null);
      try {
        const order = await loadOrder();
        if (!order?.id) return; // `denied` ya quedó puesto por loadOrder
        if (order.status === 'COMPLETED') {
          if (!cancelled) router.replace(orderPath(publicId, token));
          return;
        }
        const res = await fetch(`${API}/payments/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, externalId: `banorte_demo_${publicId}` }),
        });
        if (!res.ok) {
          const info = await readApiError(res, 'No se pudo confirmar el pago demo');
          if (!cancelled) setFailure(info);
          return;
        }
        if (!cancelled) router.replace(orderPath(publicId, token));
      } catch (e) {
        if (!cancelled) setFailure(networkError(e));
      } finally {
        if (!cancelled) setConfirming(false);
      }
    }

    if (demo || gatewayDemo) {
      void confirmDemo();
      return () => {
        cancelled = true;
      };
    }

    setConfirming(true);
    setFailure(null);
    poll = setInterval(async () => {
      try {
        const res = await fetch(`${API}/orders/${publicId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status === 'COMPLETED') router.replace(orderPath(publicId, token));
      } catch {
        /* seguimos sondeando */
      }
    }, 2500);

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [result, publicId, demo, gatewayDemo, router, token, tokenReady, loadOrder]);

  // Método efectivo: manda el de la orden, no el de la URL (que se puede editar).
  const method = (orderMeta?.paymentMethod ?? methodParam ?? 'CARD').toUpperCase();
  const isDeferred = method === 'SPEI' || method === 'OXXO';

  // Sondeo del pago diferido: OXXO puede tardar horas en acreditarse.
  useEffect(() => {
    if (!isDeferred || !publicId || orderMeta?.status === 'COMPLETED') return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API}/orders/${publicId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status === 'COMPLETED') router.replace(orderPath(publicId, token));
      } catch {
        /* seguimos sondeando */
      }
    }, 8000);
    return () => clearInterval(poll);
  }, [isDeferred, publicId, router, token, orderMeta?.status]);

  const meta = orderMeta?.pendingPayment?.metadata;
  const clabe = meta?.clabe || clabeParam || '';
  const concept = meta?.concept || meta?.reference || conceptParam || ref;
  const reference = meta?.reference || orderMeta?.pendingPayment?.reference || ref || publicId;
  const isDemoFlow = demo || gatewayDemo || meta?.demo === true;

  if (denied) {
    return <OrderAccessGate publicId={publicId} reason={denied} />;
  }

  if (result === 'cancel') {
    return (
      <div className={styles.shell}>
        <SiteHeader />
        <main className={styles.page}>
          <div className={styles.empty}>
            <h1>Pago cancelado</h1>
            <p>
              No se realizó ningún cargo{isDemoFlow ? ' (demo)' : ' en Banorte'}. Tus lugares siguen
              apartados un rato más; puedes intentarlo de nuevo.
            </p>
            <div className={styles.actions}>
              <Link href={orderPath(publicId, token)} className={styles.link}>
                Ver estado de la orden
              </Link>
              <Link href="/events" className={styles.ghost}>
                Volver a eventos
              </Link>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (isDeferred) {
    return (
      <div className={styles.shell}>
        <SiteHeader />
        <main className={styles.page}>
          <div className={styles.steps} aria-label="Progreso">
            <span className={styles.stepDone}>1 Carrito</span>
            <span className={styles.stepActive} aria-current="step">
              2 Pago
            </span>
            <span className={styles.stepTodo}>3 Boletos</span>
          </div>

          <header className={styles.hero}>
            <p className={styles.pending}>Pendiente de pago</p>
            <h1>Ya casi: falta pagar</h1>
            <p className={styles.sub}>
              Orden <code>{publicId}</code>
            </p>
          </header>

          <DeferredPaymentPanel
            method={method as 'SPEI' | 'OXXO'}
            reference={reference}
            clabe={clabe}
            concept={concept}
            amount={orderMeta?.totalAmount}
            currency={orderMeta?.currency || 'MXN'}
            expiresAt={orderMeta?.expiresAt}
            demo={isDemoFlow}
            onExpire={() => void loadOrder()}
          />

          {isDemoFlow && publicId ? (
            <SimulateDemoPaymentButton
              orderId={orderMeta?.id}
              publicId={publicId}
              accessToken={token}
            />
          ) : null}

          {failure && (
            <p className={styles.errorBox} role="alert">
              {failure.message}
            </p>
          )}

          <div className={styles.actions}>
            <Link href={orderPath(publicId, token)} className={styles.link}>
              Ver estado de la orden
            </Link>
            <Link href="/ayuda" className={styles.ghost}>
              Necesito ayuda
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.pending}>Pago en proceso</p>
          <h1>{isDemoFlow ? 'Confirmando pago demo' : 'Confirmando pago Banorte'}</h1>
          <p className={styles.sub}>
            Orden <code>{publicId}</code>
          </p>
        </header>

        <section className={styles.section} aria-live="polite">
          {confirming && (
            <p>
              {isDemoFlow
                ? 'Simulando confirmación… No cierres esta pestaña.'
                : 'Esperando la confirmación del banco (IPN Banorte). No cierres esta pestaña ni vuelvas a pagar: si ya se cargó, te llevamos a tus boletos solos.'}
            </p>
          )}
          {!confirming && !failure && <p>Redirigiendo a tus boletos…</p>}
          {failure && (
            <>
              <p className={styles.errorBox} role="alert">
                {failure.message}
              </p>
              <div className={styles.actions}>
                <Link href={orderPath(publicId, token)} className={styles.link}>
                  Ver estado de la orden
                </Link>
                <Link href="/ayuda" className={styles.ghost}>
                  Necesito ayuda
                </Link>
              </div>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function PagoPage() {
  return (
    <Suspense>
      <PagoContent />
    </Suspense>
  );
}
