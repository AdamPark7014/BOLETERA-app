'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { MoneyTabs } from './MoneyTabs';
import { Param, Stepper } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount } from '../../events/_ticket/read';
import {
  businessDaysLabel,
  calendarDaysLabel,
  readRefundPolicy,
  readRefunds,
  readTransfers,
  reasonLabel,
  refundStatusLabel,
  transferStatusLabel,
  type RefundPolicy,
  type RefundRow,
  type TransferRow,
} from './refunds';

export function RefundsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MoneyTabs current="reembolsos" />
        <RefundsBody />
      </AdminFrame>
    </Suspense>
  );
}

function RefundsBody() {
  const session = useSession();
  const [policy, setPolicy] = useState<RefundPolicy | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canSee =
    session.role === 'ADMIN' || session.role === 'SUPER_ADMIN' || session.role === 'PROMOTER';
  const canRefund = hasCapability(session.role, 'orders.refund');

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const bearer = token;
    let alive = true;
    setError(null);
    async function load() {
      const [rawPolicy, rawRefunds, rawTransfers] = await Promise.all([
        adminApi<unknown>('/payments/refund-policy', bearer),
        adminApi<unknown>('/payments/refunds?limit=100&sort=newest', bearer),
        adminApi<unknown>('/tickets/transfer/queue', bearer, { silent: true }).catch(() => null),
      ]);
      const parsedPolicy = readRefundPolicy(rawPolicy);
      const parsedRefunds = readRefunds(rawRefunds);
      if (!parsedPolicy) throw new Error('No se leyeron los plazos de reembolso.');
      if (!parsedRefunds) throw new Error('No se leyeron los reembolsos.');
      const parsedTransfers = rawTransfers ? readTransfers(rawTransfers) : null;
      if (!alive) return;
      setPolicy(parsedPolicy);
      setRefunds(parsedRefunds.rows);
      setHasMore(parsedRefunds.hasMore);
      setTransfers(parsedTransfers ?? []);
      setTransferNote(
        parsedTransfers ? null : 'No se leyeron las transferencias. Los reembolsos sí están.'
      );
    }
    void load()
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

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Reembolsos</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir reembolsos"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (!token || loading || !policy) {
    return (
      <div className={styles.skeleton} style={{ height: 360 }} aria-label="Cargando reembolsos" />
    );
  }

  return (
    <DeadlineEditor token={token} policy={policy} canSave={canRefund} onSaved={setPolicy}>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Devoluciones</h2>
          {hasMore ? <p className={styles.tertiary}>Se muestran las más recientes.</p> : null}
        </div>
        {refunds.length === 0 ? (
          <p className={styles.quiet}>No hay devoluciones registradas.</p>
        ) : (
          <div className={styles.tableWrap} style={{ border: 0, maxHeight: 'none' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Orden</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Pidió · procesó</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className={styles.num}>
                    Monto
                  </th>
                  <th scope="col">
                    <span className={styles.srOnly}>Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund) => (
                  <RefundCards
                    key={refund.id}
                    refund={refund}
                    token={token}
                    canRefund={canRefund}
                    onCompleted={() => setNonce((current) => current + 1)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Transferencias de boletos</h2>
          {transferNote ? <p className={styles.tertiary}>{transferNote}</p> : null}
        </div>
        {transfers.length === 0 && !transferNote ? (
          <p className={styles.quiet}>No hay transferencias.</p>
        ) : null}
        {transfers.length > 0 ? (
          <div className={styles.tableWrap} style={{ border: 0, maxHeight: 'none' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Boleto</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className={styles.num}>
                    Versión del QR
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <TransferCards key={transfer.id} transfer={transfer} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </DeadlineEditor>
  );
}

function DeadlineEditor({
  token,
  policy,
  canSave,
  onSaved,
  children,
}: {
  token: string;
  policy: RefundPolicy;
  canSave: boolean;
  onSaved: (policy: RefundPolicy) => void;
  children: ReactNode;
}) {
  const [settlement, setSettlement] = useState(policy.settlementBusinessDays);
  const [bank, setBank] = useState(policy.bankBusinessDays);
  const [transfer, setTransfer] = useState(policy.transferDeadlineDays);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettlement(policy.settlementBusinessDays);
    setBank(policy.bankBusinessDays);
    setTransfer(policy.transferDeadlineDays);
  }, [policy]);

  const settlementDirty = settlement !== policy.settlementBusinessDays;
  const bankDirty = bank !== policy.bankBusinessDays;
  const transferDirty = transfer !== policy.transferDeadlineDays;
  const dirty = settlementDirty || bankDirty || transferDirty;

  async function save() {
    if (!dirty || saving || !canSave) return;
    setSaving(true);
    setError(null);
    const body: {
      settlementBusinessDays?: number;
      bankBusinessDays?: number;
      transferDeadlineDays?: number;
    } = {};
    if (settlementDirty) body.settlementBusinessDays = settlement;
    if (bankDirty) body.bankBusinessDays = bank;
    if (transferDirty) body.transferDeadlineDays = transfer;
    try {
      const updated = await adminApi<unknown>('/payments/refund-policy', token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const parsed = readRefundPolicy(updated);
      if (!parsed) throw new Error('No se leyeron los plazos guardados.');
      const lines = [
        settlementDirty
          ? `Días para cerrar: ${businessDaysLabel(policy.settlementBusinessDays)} → ${businessDaysLabel(settlement)}`
          : null,
        bankDirty
          ? `Días del banco: ${businessDaysLabel(policy.bankBusinessDays)} → ${businessDaysLabel(bank)}`
          : null,
        transferDirty
          ? `Plazo de transferencia: ${calendarDaysLabel(policy.transferDeadlineDays)} → ${calendarDaysLabel(transfer)}`
          : null,
      ].filter((line): line is string => line != null);
      setNotice(lines.join(' · '));
      onSaved(parsed);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  function touch(next: () => void) {
    next();
    setNotice(null);
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reembolsos</h1>
        <p className={styles.quiet}>
          Plazos que ven los compradores en su correo y en la web. La devolución en el banco la
          cierra una persona y luego se marca aquí como completa.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Días para cerrar">
          <ParameterCard
            name="Días para cerrar"
            value={businessDaysLabel(settlementDirty ? settlement : policy.settlementBusinessDays)}
            valueStyle="tabular"
            effect={
              settlementDirty || policy.settlementSaved
                ? 'Plazo para enviar la devolución. El correo y la web leen este número.'
                : 'Sin plazo guardado. Vacío, el correo y la web siguen con este plazo.'
            }
          >
            {canSave ? (
              <Stepper
                label="Días para cerrar"
                value={settlement}
                min={1}
                max={90}
                onChange={(next) => touch(() => setSettlement(next))}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Días del banco">
          <ParameterCard
            name="Días del banco"
            value={businessDaysLabel(bankDirty ? bank : policy.bankBusinessDays)}
            valueStyle="tabular"
            effect={
              bankDirty || policy.bankSaved
                ? 'Techo del banco emisor, en días hábiles. No se descuentan los festivos.'
                : 'Sin plazo guardado. Vacío, el techo del banco sigue en este plazo. No se descuentan los festivos.'
            }
          >
            {canSave ? (
              <Stepper
                label="Días del banco"
                value={bank}
                min={1}
                max={90}
                onChange={(next) => touch(() => setBank(next))}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Plazo de transferencia">
          <ParameterCard
            name="Plazo de transferencia"
            value={calendarDaysLabel(transferDirty ? transfer : policy.transferDeadlineDays)}
            valueStyle="tabular"
            effect={
              transferDirty || policy.transferSaved
                ? 'La oferta nueva caduca en este plazo, en días corridos. Las que ya salieron conservan su fecha.'
                : 'Sin plazo guardado. Vacío, la oferta nueva caduca en este plazo, en días corridos.'
            }
          >
            {canSave ? (
              <Stepper
                label="Plazo de transferencia"
                value={transfer}
                min={1}
                max={90}
                onChange={(next) => touch(() => setTransfer(next))}
              />
            ) : null}
          </ParameterCard>
        </Param>
        {error ? (
          <p className={styles.danger} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {canSave ? (
        <div className={styles.saveBar} style={{ position: 'static' }}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
            Guardar cambios
          </TicketButton>
        </div>
      ) : null}
      <div className={styles.stack} style={{ marginTop: 24, gap: 20 }}>
        {children}
      </div>
    </section>
  );
}

function RefundCards({
  refund,
  token,
  canRefund,
  onCompleted,
}: {
  refund: RefundRow;
  token: string;
  canRefund: boolean;
  onCompleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = formatTicketAmount(refund.amount);
  const pending = refund.status === 'PENDING';

  async function complete() {
    if (busy || !canRefund) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/payments/refunds/${refund.id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onCompleted();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se marcó. Revisa la conexión.');
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <span className={styles.mono}>{refund.publicId}</span>
        {refund.eventTitle ? <p className={styles.rowMeta}>{refund.eventTitle}</p> : null}
      </td>
      <td>
        {reasonLabel(refund.reason)}
        {refund.notes ? <p className={styles.rowMeta}>{refund.notes}</p> : null}
      </td>
      <td className={styles.quiet}>
        {refund.requestedBy ?? '—'} · {refund.processedBy ?? '—'}
      </td>
      <td>
        <span
          className={
            pending ? styles.chipWarn : refund.status === 'COMPLETED' ? styles.chipOk : styles.chip
          }
        >
          {refundStatusLabel(refund.status)}
        </span>
      </td>
      <td className={styles.num}>
        <strong style={{ color: 'var(--money-out)' }}>− {amount}</strong>
      </td>
      <td className={styles.num}>
        {pending && canRefund ? (
          confirming ? (
            <TicketButton variant="danger" disabled={busy} onClick={() => void complete()}>
              {busy ? 'Marcando' : `Confirmar ${amount}`}
            </TicketButton>
          ) : (
            <TicketButton variant="secondary" onClick={() => setConfirming(true)}>
              Marcar completo
            </TicketButton>
          )
        ) : null}
        {error ? (
          <p className={styles.danger} role="alert">
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

function TransferCards({ transfer }: { transfer: TransferRow }) {
  return (
    <tr>
      <td>
        <span className={styles.mono}>{transfer.folio}</span>
        {transfer.eventTitle ? <p className={styles.rowMeta}>{transfer.eventTitle}</p> : null}
      </td>
      <td>
        <span className={styles.chipGold}>{transferStatusLabel(transfer.status)}</span>
      </td>
      <td className={styles.num}>{formatCount(transfer.keyEpoch)}</td>
    </tr>
  );
}
