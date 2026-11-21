'use client';

import { Suspense, useEffect, useState } from 'react';
import { TicketButton, TicketState } from '@boletera/ui';
import { ApiError, adminApi, adminDownload } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { NoAccess } from '../../events/_ticket/NoAccess';
import styles from '../../events/_ticket/frame.module.scss';

type Row = {
  id: string;
  publicId: string;
  sellerPayout: string;
  fee: string;
  currency: string;
  payoutStatus: string;
  sellerClabe: string | null;
  payoutReference: string | null;
  completedAt: string | null;
  event: { title: string };
};

function money(value: string, currency: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(
    n
  );
}

export default function ResaleSellerPayoutsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <Body />
      </AdminFrame>
    </Suspense>
  );
}

function Body() {
  const session = useSession();
  const token = session.token;
  const canSee = hasCapability(session.role, 'finance.view');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<'PENDING' | 'PAID' | ''>('PENDING');
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!token || !canSee) return;
    let alive = true;
    setError(null);
    const q = status ? `?status=${status}` : '';
    adminApi<Row[]>(`/admin/resale/seller-payouts${q}`, token)
      .then((data) => {
        if (alive) setRows(Array.isArray(data) ? data : []);
      })
      .catch((cause) => {
        if (alive) setError(cause);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Reventa · Pagos a vendedores</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir pagos de reventa"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (rows === null) {
    return <div className={styles.skeleton} style={{ height: 320 }} aria-label="Cargando pagos" />;
  }

  async function markPaid(id: string) {
    if (!token) return;
    const reference = window.prompt('Referencia SPEI del depósito');
    if (!reference?.trim()) return;
    setBusyId(id);
    setNotice(null);
    try {
      await adminApi(`/admin/resale/seller-payouts/${id}/paid`, token, {
        method: 'POST',
        body: JSON.stringify({ reference: reference.trim() }),
      });
      setNotice('Pago marcado como depositado.');
      setNonce((n) => n + 1);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.userMessage : 'No se pudo marcar el pago.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reventa · Pagos a vendedores</h1>
        <div className={styles.row} style={{ gap: 8 }}>
          <select
            aria-label="Estado"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="PENDING">Pendientes</option>
            <option value="PAID">Pagados</option>
            <option value="">Todos</option>
          </select>
          <TicketButton
            type="button"
            variant="secondary"
            onClick={() => {
              if (!token) return;
              const q = status ? `?status=${status}` : '';
              adminDownload(`/admin/resale/seller-payouts.csv${q}`, token, 'reventa-pagos.csv');
            }}
          >
            Exportar CSV
          </TicketButton>
        </div>
      </header>
      {notice ? <p role="status">{notice}</p> : null}
      {rows.length === 0 ? (
        <TicketState
          kind="empty"
          title="No hay pagos en este filtro"
          body="Cuando se venda un boleto en reventa, aquí verás lo que hay que depositar al vendedor."
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <strong>{row.event.title}</strong>
              <p>
                {money(row.sellerPayout, row.currency)} ·{' '}
                {row.payoutStatus === 'PAID' ? 'Depositado' : 'Pendiente'}
                {row.sellerClabe ? ` · CLABE ${row.sellerClabe}` : ' · Sin CLABE'}
              </p>
              <p>{row.publicId}</p>
              {row.payoutStatus !== 'PAID' ? (
                <TicketButton
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => markPaid(row.id)}
                >
                  Marcar pagado
                </TicketButton>
              ) : (
                <p>Ref. {row.payoutReference}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
