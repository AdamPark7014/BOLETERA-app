'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Money, TicketButton } from '@boletera/ui';
import { networkError, readApiError, type ApiErrorInfo } from '@/lib/api-errors';
import { authHeaders, clearSession, getToken } from '@/lib/auth';
import purchase from '@/components/purchase/purchase.module.scss';
import styles from './membresias.module.scss';
import { periodLabel, periodSuffix, type CheckoutStatus, type PublicPlan } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';
const LOGIN_BACK = '/login?next=%2Fmembresias';

const METHODS = [
  { id: 'CARD', label: 'Tarjeta' },
  { id: 'SPEI', label: 'SPEI' },
  { id: 'OXXO', label: 'OXXO' },
] as const;
type MethodId = (typeof METHODS)[number]['id'];

function priceLine(plan: PublicPlan) {
  const amount = Number(plan.price).toLocaleString('es-MX', {
    style: 'currency',
    currency: plan.currency || 'MXN',
  });
  return `${amount} ${periodSuffix(plan.billingPeriod)}`;
}

/**
 * Elegir plan → método → pagar. El cobro es el de las órdenes (Banorte): el API
 * crea el intent y aquí solo se sigue la acción que devuelve.
 */
export function PlanesClient({ plans }: { plans: PublicPlan[] }) {
  const router = useRouter();
  const firstOpen = plans.find((p) => !p.soldOut) ?? null;
  const [selected, setSelected] = useState<string | null>(firstOpen?.id ?? null);
  const [method, setMethod] = useState<MethodId>('CARD');
  const [offered, setOffered] = useState<MethodId[]>(['CARD', 'SPEI', 'OXXO']);
  const [demo, setDemo] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
    const controller = new AbortController();
    fetch(`${API}/payments/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean; methods?: string[] } | null) => {
        if (cfg?.demo) setDemo(true);
        const methods = cfg?.methods;
        if (Array.isArray(methods)) {
          const list = METHODS.map((m) => m.id).filter((id) => methods.includes(id));
          if (list.length) setOffered(list);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!offered.includes(method)) setMethod(offered[0]);
  }, [offered, method]);

  const plan = plans.find((p) => p.id === selected) ?? null;

  async function buy() {
    if (!plan) return;
    if (!getToken()) {
      router.push(LOGIN_BACK);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`${API}/memberships/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planId: plan.id, paymentMethod: method }),
      });
      if (res.status === 401) {
        clearSession();
        router.push(LOGIN_BACK);
        return;
      }
      if (!res.ok) {
        setFailure(await readApiError(res, 'No se pudo iniciar la compra'));
        return;
      }
      const checkout = (await res.json()) as CheckoutStatus;
      // Tarjeta real: a Payworks. En demo y en SPEI/OXXO, a la pantalla de pago.
      if (checkout.payment.redirectUrl && !checkout.payment.demo) {
        window.location.href = checkout.payment.redirectUrl;
        return;
      }
      router.push(`/membresias/pago/${encodeURIComponent(checkout.publicId)}`);
    } catch (e) {
      setFailure(networkError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className={styles.plans} aria-label="Planes">
        {plans.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={styles.plan}
              aria-pressed={selected === p.id}
              disabled={p.soldOut}
              onClick={() => setSelected(p.id)}
            >
              <span className={styles.planHead}>
                <strong>{p.name}</strong>
                <span className={styles.planPrice}>{priceLine(p)}</span>
              </span>
              <span className={styles.planMeta}>
                {p.tier} · {periodLabel(p.billingPeriod)}
                {p.soldOut ? ' · Sin cupo' : ''}
              </span>
              {p.description ? <span className={styles.planText}>{p.description}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      {plan ? (
        <section className={purchase.stack} aria-labelledby="beneficios-title">
          <h2 id="beneficios-title" className={purchase.title}>
            Beneficios de {plan.name}
          </h2>
          {plan.benefits.length === 0 ? (
            <p className={purchase.lead}>Este plan todavía no tiene beneficios publicados.</p>
          ) : (
            <ul className={purchase.seatList}>
              {plan.benefits.map((b) => (
                <li key={b.id}>
                  <span className={styles.benefit}>
                    <span>{b.name}</span>
                    {b.description ? (
                      <span className={purchase.caption}>{b.description}</span>
                    ) : null}
                  </span>
                  {b.redemptionLimit != null ? (
                    <span className={purchase.mono}>
                      {b.redemptionLimit} {b.redemptionLimit === 1 ? 'uso' : 'usos'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className={purchase.segment} role="radiogroup" aria-label="Método de pago">
            {METHODS.filter((m) => offered.includes(m.id)).map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                aria-pressed={method === m.id}
                onClick={() => setMethod(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className={purchase.lead}>
            {method === 'CARD'
              ? 'Pagas con tarjeta en Banorte y vuelves a tu cuenta.'
              : method === 'SPEI'
                ? 'Te damos CLABE y referencia; la membresía se activa al acreditarse.'
                : 'Te damos una referencia OXXO; la membresía se activa al acreditarse.'}
          </p>
          {demo ? (
            <p className={purchase.caption}>Pasarela en demostración. Este cargo no cobra.</p>
          ) : null}
          {failure ? (
            <div className={purchase.error} role="alert">
              <span>{failure.message}</span>
            </div>
          ) : null}
        </section>
      ) : (
        <p className={purchase.lead}>Todos los planes están sin cupo por ahora.</p>
      )}

      {plan ? (
        <div className={purchase.dock}>
          <div className={purchase.dockInner}>
            <Money label="Total" amount={Number(plan.price)} currency />
            {signedIn ? (
              <TicketButton type="button" onClick={() => void buy()} disabled={busy}>
                {busy ? 'Preparando pago' : 'Pagar membresía'}
              </TicketButton>
            ) : (
              <Link href={LOGIN_BACK} className={purchase.link}>
                Entrar para comprar
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
