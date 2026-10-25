'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, readString } from '../events/_ticket/read';

const STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  NOTIFIED: 'Avisado',
  CONVERTED: 'Convertido',
  EXPIRED: 'Caducado',
  CANCELLED: 'Cancelado',
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
          }),
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
        await adminApi(`/waitlist/event/${eventId}/notify`, token, { method: 'POST', body: '{}' }),
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
          <h1 className={styles.sectionTitle}>Espera</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir la espera" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando espera.</p>;

  const groups = new Map<string, { title: string; rows: Entry[] }>();
  for (const entry of entries) {
    const current = groups.get(entry.eventId) ?? { title: entry.eventTitle, rows: [] };
    current.rows.push(entry);
    groups.set(entry.eventId, current);
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Espera</h1>
        <p className={styles.quiet}>
          El estado lo escribe el servicio. No hay un guardado que lo elija. Avisar marca pendientes
          como avisados.
        </p>
        {notice ? <p className={styles.tertiary}>{notice}</p> : null}
      </header>
      {entries.length === 0 ? <p className={styles.quiet}>No hay espera.</p> : null}
      {[...groups.entries()].map(([eventId, group]) => {
        const pending = group.rows.some((row) => row.status === 'PENDING');
        return (
          <div key={eventId || group.title} className={styles.stack}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{group.title}</h2>
            </header>
            {group.rows.map((row) => (
              <Param key={row.id} name="Estado en la espera">
                <ParameterCard
                  name="Estado en la espera"
                  value={word(row.status)}
                  effect={row.email}
                />
              </Param>
            ))}
            {canNotify && pending ? (
              <TicketButton
                variant="secondary"
                disabled={busy === eventId}
                onClick={() => void notify(eventId, group.title)}
              >
                Avisar
              </TicketButton>
            ) : null}
          </div>
        );
      })}
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
