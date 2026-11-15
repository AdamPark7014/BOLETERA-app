'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import Link from 'next/link';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatWhen, readNumber, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  COMPLETED: 'Completo',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};

const STATUS_CHIP: Record<string, string> = {
  PENDING: styles.chipWarn,
  PROCESSING: styles.chipGold,
  COMPLETED: styles.chipOk,
  FAILED: styles.chipDanger,
  CANCELLED: styles.chip,
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
        setOpenId((current) =>
          current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)
        );
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
          : 'Liquidación en proceso'
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
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir liquidaciones"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando liquidaciones">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 360 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 320 }} />
      </div>
    );
  }

  const ambiguous = payouts.some((item) => item.ambiguous);
  const sameCurrency = !ambiguous && payouts.every((item) => item.currency === 'MXN');
  const pending = payouts.filter(
    (item) => item.status === 'PENDING' || item.status === 'PROCESSING'
  );
  const done = payouts.filter((item) => item.status === 'COMPLETED');
  const sum = (list: Payout[]) => list.reduce((total, item) => total + item.net, 0);

  return (
    <section className={styles.stack} style={{ gap: 20 }}>
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <h1 className={styles.sectionTitle}>Liquidaciones</h1>
        <p className={styles.quiet}>
          Lo que Black Ticket te transfiere por cada periodo de venta. Para completar una, captura
          la referencia de la transferencia.
        </p>
        {ambiguous ? (
          <p className={styles.tertiary}>
            Hay ventas en varias monedas: los importes no se suman entre sí.
          </p>
        ) : null}
      </header>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Por pagar</p>
          <p className={styles.kpiValue}>{sameCurrency ? formatTicketAmount(sum(pending)) : '—'}</p>
          <p className={styles.kpiNote}>
            <span className={pending.length > 0 ? styles.down : undefined}>
              {pending.length}{' '}
              {pending.length === 1 ? 'liquidación abierta' : 'liquidaciones abiertas'}
            </span>
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Pagado</p>
          <p className={styles.kpiValue}>{sameCurrency ? formatTicketAmount(sum(done)) : '—'}</p>
          <p className={styles.kpiNote}>
            <span className={done.length > 0 ? styles.up : undefined}>
              {done.length} {done.length === 1 ? 'completada' : 'completadas'}
            </span>
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Aviso automático</p>
          <p className={styles.kpiValue}>Apagado</p>
          <p className={styles.kpiNote}>
            Lo configura Black Ticket; la transferencia se hace aparte.
          </p>
        </div>
      </div>

      {payouts.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay liquidaciones</p>
          <p className={styles.quiet}>
            Se generan al cerrar cada periodo con ventas cobradas. Mientras, revisa el corte de
            venta.
          </p>
          <Link href="/reports" className={styles.ghostLink}>
            Ver reportes
          </Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Periodo</th>
                <th scope="col" className={styles.num}>
                  Bruto
                </th>
                <th scope="col" className={styles.num}>
                  Comisión
                </th>
                <th scope="col" className={styles.num}>
                  Neto
                </th>
                <th scope="col">Estado</th>
                <th scope="col">Referencia</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => {
                const open = openId === payout.id;
                const status = STATUS[payout.status] ?? payout.status;
                const reference = refs[payout.id] ?? payout.referenceId ?? '';
                const actionable =
                  canSettle && (payout.status === 'PENDING' || payout.status === 'PROCESSING');
                return (
                  <Fragment key={payout.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className={styles.rowToggle}
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : payout.id)}
                        >
                          {formatWhen(payout.periodStart)} – {formatWhen(payout.periodEnd)}
                        </button>
                        {payout.ambiguous ? (
                          <p className={styles.rowMeta}>Varias monedas</p>
                        ) : payout.currency && payout.currency !== 'MXN' ? (
                          <p className={styles.rowMeta}>{payout.currency}</p>
                        ) : null}
                      </td>
                      <td className={styles.num}>
                        {amountLabel(payout.gross, payout.currency, payout.ambiguous)}
                      </td>
                      <td className={styles.num} style={{ color: 'var(--text-secondary)' }}>
                        − {amountLabel(payout.commission, payout.currency, payout.ambiguous)}
                      </td>
                      <td className={styles.num}>
                        <strong>
                          {amountLabel(payout.net, payout.currency, payout.ambiguous)}
                        </strong>
                      </td>
                      <td>
                        <span className={STATUS_CHIP[payout.status] ?? styles.chip}>{status}</span>
                      </td>
                      <td>
                        {payout.referenceId ? (
                          <span className={styles.mono}>{payout.referenceId}</span>
                        ) : actionable ? (
                          <button
                            type="button"
                            className={styles.panelLinkButton}
                            onClick={() => setOpenId(payout.id)}
                          >
                            Capturar y liquidar
                          </button>
                        ) : (
                          <span className={styles.quiet}>—</span>
                        )}
                      </td>
                    </tr>
                    {open && actionable ? (
                      <tr>
                        <td colSpan={6} className={styles.detailCell}>
                          <div className={styles.detailRow}>
                            <div style={{ flex: '1 1 260px' }}>
                              <Field
                                label="Referencia de la transferencia"
                                hint="Obligatoria para completar."
                                placeholder="Clave de rastreo SPEI"
                                value={reference}
                                onChange={(event) => {
                                  setRefs((current) => ({
                                    ...current,
                                    [payout.id]: event.target.value,
                                  }));
                                  setNotice(null);
                                }}
                              />
                            </div>
                            {payout.status === 'PENDING' ? (
                              <TicketButton
                                variant="ghost"
                                disabled={busy === payout.id}
                                onClick={() => void act(payout, 'process')}
                              >
                                Pasar a proceso
                              </TicketButton>
                            ) : null}
                            <TicketButton
                              disabled={busy === payout.id || !reference.trim()}
                              onClick={() => void act(payout, 'complete')}
                            >
                              Completar liquidación
                            </TicketButton>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.chipOk} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
