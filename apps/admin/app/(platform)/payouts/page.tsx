'use client';

import { Suspense, useEffect, useState } from 'react';
import { Field, Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatWhen, readNumber, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  COMPLETED: 'Completo',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};

type Payout = {
  id: string;
  gross: number;
  commission: number;
  net: number;
  currency: string | null;
  ambiguous: boolean;
  status: string;
  referenceId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

function amountLabel(value: number, currency: string | null, ambiguous: boolean): string {
  if (ambiguous || currency !== 'MXN') {
    return value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return formatTicketAmount(value);
}

function readPayout(raw: unknown): Payout | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const gross = readNumber(row.grossRevenue);
  const commission = readNumber(row.commission);
  const net = readNumber(row.netAmount);
  if (!id || gross == null || commission == null || net == null) return null;
  return {
    id,
    gross,
    commission,
    net,
    currency: readString(row.currency),
    ambiguous: row.currencyAmbiguous === true,
    status: readString(row.status) ?? 'PENDING',
    referenceId: readString(row.referenceId),
    periodStart: readString(row.periodStart),
    periodEnd: readString(row.periodEnd),
  };
}

function readPayouts(payload: unknown): Payout[] {
  const row = asRecord(payload);
  const list = Array.isArray(row.payouts) ? row.payouts : [];
  return list.flatMap((item) => {
    const payout = readPayout(item);
    return payout ? [payout] : [];
  });
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <LiquidacionesBody />
      </AdminFrame>
    </Suspense>
  );
}

function LiquidacionesBody() {
  const session = useSession();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee = hasCapability(session.role, 'finance.view');
  const canSettle = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>('/admin/payouts', token)
      .then((payload) => {
        if (!alive) return;
        const next = readPayouts(payload);
        setPayouts(next);
        setRefs(Object.fromEntries(next.map((item) => [item.id, item.referenceId ?? ''])));
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, session.status, nonce]);

  async function act(payout: Payout, action: 'process' | 'complete') {
    if (!token || busy) return;
    const reference = (refs[payout.id] ?? '').trim();
    if (action === 'complete' && !reference) return;
    setBusy(payout.id);
    setActionError(null);
    try {
      await adminApi(`/admin/payouts/${payout.id}/${action}`, token, {
        method: 'POST',
        body: JSON.stringify(reference ? { referenceId: reference } : {}),
      });
      setNotice(
        action === 'complete'
          ? `Liquidación completa · ${amountLabel(payout.net, payout.currency, payout.ambiguous)} · ${reference}`
          : 'Liquidación en proceso',
      );
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Liquidaciones</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir liquidaciones" onRetry={() => setNonce((current) => current + 1)} />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando liquidaciones.</p>;

  const ambiguous = payouts.some((item) => item.ambiguous);

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Liquidaciones</h1>
        <p className={styles.quiet}>No hay calendario. Completar pide la referencia.</p>
        {ambiguous ? (
          <p className={styles.tertiary}>Hay varias monedas en las ventas. Los importes no se suman.</p>
        ) : null}
      </header>
      <div className={styles.stack}>
        <Param name="Aviso de liquidación">
          <ParameterCard
            name="Aviso de liquidación"
            value="Apagado"
            effect="Lo fija el entorno. Encendido, el worker solo avisa: no hay riel bancario. Aquí se lee."
          />
        </Param>
      </div>
      {payouts.length === 0 ? <p className={styles.quiet}>No hay liquidaciones.</p> : null}
      <div className={styles.stack}>
        {payouts.map((payout) => {
          const open = openId === payout.id;
          const status = STATUS[payout.status] ?? payout.status;
          const reference = refs[payout.id] ?? payout.referenceId ?? '';
          const actionable = canSettle && (payout.status === 'PENDING' || payout.status === 'PROCESSING');
          const currency = payout.ambiguous ? 'Sin moneda' : (payout.currency ?? '—');
          return (
            <div key={payout.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : payout.id)}
              >
                <span>
                  {formatWhen(payout.periodStart)} – {formatWhen(payout.periodEnd)}
                </span>
                <span className={styles.figure}>{amountLabel(payout.net, payout.currency, payout.ambiguous)}</span>
              </button>
              {open ? (
                <>
                  <Param name="Bruto">
                    <ParameterCard
                      name="Bruto"
                      value={amountLabel(payout.gross, payout.currency, payout.ambiguous)}
                      valueStyle="tabular"
                      effect="Venta del periodo."
                    />
                  </Param>
                  <Param name="Comisión del periodo">
                    <ParameterCard
                      name="Comisión del periodo"
                      value={amountLabel(payout.commission, payout.currency, payout.ambiguous)}
                      valueStyle="tabular"
                      effect="Lo retenido en esta liquidación."
                    />
                  </Param>
                  <Param name="Neto">
                    <ParameterCard
                      name="Neto"
                      value={amountLabel(payout.net, payout.currency, payout.ambiguous)}
                      valueStyle="tabular"
                      effect="Es el monto de la liquidación."
                    >
                      {!payout.ambiguous && payout.currency === 'MXN' ? (
                        <Money
                          label="Neto"
                          amount={payout.net}
                          currency
                          direction={payout.status === 'COMPLETED' ? 'in' : 'neutral'}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Moneda de la liquidación">
                    <ParameterCard
                      name="Moneda de la liquidación"
                      value={currency}
                      effect="La devuelve el API. Evita sumar monedas distintas."
                    />
                  </Param>
                  <Param name="Estado de la liquidación">
                    <ParameterCard
                      name="Estado de la liquidación"
                      value={status}
                      effect="Pendiente, en proceso, completo, fallido o cancelado. El API escribe en proceso y completo."
                    />
                  </Param>
                  <Param name="Referencia">
                    <ParameterCard
                      name="Referencia"
                      value={reference.trim() || payout.referenceId || '—'}
                      valueStyle="mono"
                      effect="Obligatoria para completar."
                    >
                      {actionable ? (
                        <Field
                          label="Referencia"
                          hint="Obligatoria para completar."
                          placeholder="SPEI"
                          value={reference}
                          onChange={(event) => {
                            setRefs((current) => ({ ...current, [payout.id]: event.target.value }));
                            setNotice(null);
                          }}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Periodo desde">
                    <ParameterCard
                      name="Periodo desde"
                      value={formatWhen(payout.periodStart)}
                      effect="No es un calendario editable."
                    />
                  </Param>
                  <Param name="Periodo hasta">
                    <ParameterCard
                      name="Periodo hasta"
                      value={formatWhen(payout.periodEnd)}
                      effect="Cierre del periodo. Se lee."
                    />
                  </Param>
                  {actionable ? (
                    <div className={styles.stack}>
                      {payout.status === 'PENDING' ? (
                        <TicketButton variant="ghost" disabled={busy === payout.id} onClick={() => void act(payout, 'process')}>
                          Pasar a proceso
                        </TicketButton>
                      ) : null}
                      <TicketButton
                        variant="secondary"
                        disabled={busy === payout.id || !reference.trim()}
                        onClick={() => void act(payout, 'complete')}
                      >
                        Completar liquidación
                      </TicketButton>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? <p className={styles.quiet}>{notice}</p> : null}
    </section>
  );
}
