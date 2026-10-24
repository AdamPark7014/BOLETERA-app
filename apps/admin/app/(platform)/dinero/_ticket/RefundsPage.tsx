'use client';

import { Suspense, useEffect, useState } from 'react';
import { Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount } from '../../events/_ticket/read';
import {
  businessDaysLabel,
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
          <p className={styles.quiet}>Sin secciones.</p>
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
  if (!token || loading || !policy) return <p className={styles.quiet}>Cargando reembolsos.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reembolsos</h1>
        <p className={styles.quiet}>
          Los plazos los fija el entorno. Cerrar el dinero en Banorte lo hace una persona.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Días para cerrar">
          <ParameterCard
            name="Días para cerrar"
            value={businessDaysLabel(policy.settlementBusinessDays)}
            valueStyle="tabular"
            effect="Plazo para enviar la devolución. El correo y la web leen este número."
          />
        </Param>
        <Param name="Días del banco">
          <ParameterCard
            name="Días del banco"
            value={businessDaysLabel(policy.bankBusinessDays)}
            valueStyle="tabular"
            effect="Techo del banco emisor, en días hábiles. No se descuentan los festivos."
          />
        </Param>
        {refunds.length === 0 ? <p className={styles.quiet}>No hay reembolsos.</p> : null}
        {hasMore ? <p className={styles.tertiary}>Hay más reembolsos.</p> : null}
        {refunds.map((refund) => (
          <RefundCards
            key={refund.id}
            refund={refund}
            token={token}
            canRefund={canRefund}
            onCompleted={() => setNonce((current) => current + 1)}
          />
        ))}
        <p className={styles.tertiary}>Transferencias</p>
        {transferNote ? <p className={styles.tertiary}>{transferNote}</p> : null}
        {transfers.length === 0 && !transferNote ? (
          <p className={styles.quiet}>No hay transferencias.</p>
        ) : null}
        {transfers.map((transfer) => (
          <TransferCards key={transfer.id} transfer={transfer} />
        ))}
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
    <div className={styles.stack}>
      <p className={styles.rowTitle}>
        <span className={styles.mono}>{refund.publicId}</span>
        {refund.eventTitle ? ` · ${refund.eventTitle}` : ''}
      </p>
      <Param name="Monto del reembolso">
        <ParameterCard
          name="Monto del reembolso"
          value={amount}
          valueStyle="tabular"
          effect="Lo devuelto en esta fila."
        >
          <Money label="Monto del reembolso" amount={refund.amount} direction="out" />
        </ParameterCard>
      </Param>
      <Param name="Razón">
        <ParameterCard
          name="Razón"
          value={reasonLabel(refund.reason)}
          effect="Por qué se pidió la devolución."
        />
      </Param>
      <Param name="Estado del reembolso">
        <ParameterCard
          name="Estado del reembolso"
          value={refundStatusLabel(refund.status)}
          effect="Pendiente hasta que alguien lo marca completo en el portal del banco."
        />
      </Param>
      <Param name="Notas">
        <ParameterCard name="Notas" value={refund.notes ?? '—'} effect="Una línea interna." />
      </Param>
      <Param name="Quién pidió">
        <ParameterCard
          name="Quién pidió"
          value={refund.requestedBy ?? '—'}
          effect="Solicitante de la devolución."
        />
      </Param>
      <Param name="Quién procesó">
        <ParameterCard
          name="Quién procesó"
          value={refund.processedBy ?? '—'}
          effect="Quien marcó el cierre."
        />
      </Param>
      {pending && canRefund ? (
        confirming ? (
          <TicketButton variant="danger" disabled={busy} onClick={() => void complete()}>
            {`Marcar reembolso completo · ${amount} · ${refund.publicId}`}
          </TicketButton>
        ) : (
          <TicketButton variant="secondary" onClick={() => setConfirming(true)}>
            Marcar reembolso completo
          </TicketButton>
        )
      ) : null}
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TransferCards({ transfer }: { transfer: TransferRow }) {
  return (
    <div className={styles.stack}>
      <p className={styles.rowTitle}>
        <span className={styles.mono}>{transfer.folio}</span>
        {transfer.eventTitle ? ` · ${transfer.eventTitle}` : ''}
      </p>
      <Param name="Estado de la transferencia">
        <ParameterCard
          name="Estado de la transferencia"
          value={transferStatusLabel(transfer.status)}
          effect="Una pendiente por boleto. Aceptar apaga el QR anterior."
        />
      </Param>
      <Param name="Época de la clave">
        <ParameterCard
          name="Época de la clave"
          value={formatCount(transfer.keyEpoch)}
          valueStyle="tabular"
          effect="Sube al aceptar y deja de servir la clave anterior."
        />
      </Param>
    </div>
  );
}
