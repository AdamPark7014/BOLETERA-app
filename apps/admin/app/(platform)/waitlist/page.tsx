'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { TicketButton, TicketState } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  NOTIFIED: 'Avisado',
  CONVERTED: 'Convertido',
  EXPIRED: 'Caducado',
  CANCELLED: 'Cancelado',
};

const STATUS_CHIP: Record<string, string> = {
  PENDING: styles.chipWarn,
  NOTIFIED: styles.chipGold,
  CONVERTED: styles.chipOk,
  EXPIRED: styles.chip,
  CANCELLED: styles.chip,
};

const SEE = ['ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER'];

type Entry = {
  id: string;
  email: string;
  status: string;
  eventId: string;
  eventTitle: string;
};

function word(value: string): string {
  return STATUS[value] ?? value;
}

function readEntry(raw: unknown): Entry | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const email = readString(row.email);
  if (!id || !email) return null;
  const event = asRecord(row.event);
  return {
    id,
    email,
    status: readString(row.status) ?? 'PENDING',
    eventId: readString(row.eventId) ?? readString(event.id) ?? '',
    eventTitle: readString(event.title) ?? 'Función',
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function WaitlistPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EsperaBody />
      </AdminFrame>
    </Suspense>
  );
}

function EsperaBody() {
  const session = useSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const role = session.role;
  const canSee = role === 'SUPER_ADMIN' || (role != null && SEE.includes(role));
  const canNotify = hasCapability(role, 'marketing.manage');

  useEffect(() => {
    if (!token || !session.orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>(`/waitlist/organization/${session.orgId}`, token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        setEntries(
          list.flatMap((item) => {
            const entry = readEntry(item);
            return entry ? [entry] : [];
          })
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
  }, [token, session.orgId, canSee, session.status, nonce]);

  async function notify(eventId: string, title: string) {
    if (!token || busy) return;
    setBusy(eventId);
    setActionError(null);
    try {
      const result = asRecord(
        await adminApi(`/waitlist/event/${eventId}/notify`, token, { method: 'POST', body: '{}' })
      );
      const count = typeof result.notified === 'number' ? result.notified : null;
      setNotice(count == null ? `Avisados · ${title}` : `Avisados · ${title} · ${count}`);
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
          <h1 className={styles.sectionTitle}>Lista de espera</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir la espera"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando lista de espera">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 320 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 280 }} />
      </div>
    );
  }

  const groups = new Map<string, { title: string; rows: Entry[] }>();
  for (const entry of entries) {
    const current = groups.get(entry.eventId) ?? { title: entry.eventTitle, rows: [] };
    current.rows.push(entry);
    groups.set(entry.eventId, current);
  }
  const pendingTotal = entries.filter((row) => row.status === 'PENDING').length;
  const notifiedTotal = entries.filter((row) => row.status === 'NOTIFIED').length;
  const convertedTotal = entries.filter((row) => row.status === 'CONVERTED').length;

  return (
    <section className={styles.page}>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Lista de espera</h1>
      </header>
      {notice ? (
        <p className={styles.chipOk} role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>En espera</p>
          <p className={styles.kpiValue}>{pendingTotal.toLocaleString('es-MX')}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Avisados</p>
          <p className={styles.kpiValue}>{notifiedTotal.toLocaleString('es-MX')}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>Compraron</p>
          <p className={styles.kpiValue}>{convertedTotal.toLocaleString('es-MX')}</p>
          <p className={styles.kpiNote}>
            <span className={convertedTotal > 0 ? styles.up : undefined}>
              {notifiedTotal + convertedTotal > 0
                ? `${Math.round((convertedTotal / (notifiedTotal + convertedTotal)) * 100)}% de los avisados`
                : 'aún sin avisos'}
            </span>
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <TicketState
          kind="empty"
          title="Nadie está en lista de espera"
          action={
            <Link href="/events" className={styles.ghostLink}>
              Ver eventos
            </Link>
          }
        />
      ) : null}

      {[...groups.entries()].map(([eventId, group]) => {
        const pending = group.rows.filter((row) => row.status === 'PENDING').length;
        return (
          <div key={eventId || group.title} className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>{group.title}</h2>
                <p className={styles.rowMeta}>
                  {group.rows.length} {group.rows.length === 1 ? 'persona' : 'personas'} · {pending}{' '}
                  {pending === 1 ? 'pendiente' : 'pendientes'}
                </p>
              </div>
              {canNotify && pending > 0 ? (
                <TicketButton
                  disabled={busy === eventId}
                  onClick={() => void notify(eventId, group.title)}
                >
                  {busy === eventId ? 'Avisando' : `Avisar a ${pending}`}
                </TicketButton>
              ) : null}
            </div>
            <div className={styles.tableWrap} style={{ border: 0, maxHeight: 360 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Correo</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} data-param={row.email}>
                      <td>{row.email}</td>
                      <td>
                        <span className={STATUS_CHIP[row.status] ?? styles.chip}>
                          {word(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
