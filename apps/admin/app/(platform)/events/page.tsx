'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketButton, formatNumber } from '@boletera/ui';
import { hasCapability } from '@/lib/permissions';
import { listEvents, type EventRow } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from './_shared/api-state';
import { AdminFrame, useAdminFrame } from './_ticket/AdminFrame';
import styles from './_ticket/frame.module.scss';
import { formatWhen, statusLabel } from './_ticket/read';

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EventsBody />
      </AdminFrame>
    </Suspense>
  );
}

function EventsBody() {
  const session = useSession();
  const frame = useAdminFrame();
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canCreate = hasCapability(session.role, 'events.manage');

  useEffect(() => {
    if (!token) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listEvents(token)
      .then((rows) => {
        setEvents(rows);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [token, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="listar los eventos de tu organización"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }

  const needle = frame.query.trim().toLowerCase();
  const filtered = events.filter((event) => {
    if (!needle) return true;
    const venue = event.venue?.name ?? '';
    return (
      event.title.toLowerCase().includes(needle) ||
      event.slug.toLowerCase().includes(needle) ||
      venue.toLowerCase().includes(needle) ||
      statusLabel(event.status).toLowerCase().includes(needle)
    );
  });

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Eventos</h1>
      </header>
      {loading ? <p className={styles.quiet}>Cargando eventos.</p> : null}
      {!loading && events.length === 0 ? <p className={styles.quiet}>No hay eventos.</p> : null}
      {!loading && events.length > 0 && filtered.length === 0 ? (
        <p className={styles.quiet}>Nada con ese criterio.</p>
      ) : null}
      <ul className={styles.rows}>
        {filtered.map((event) => (
          <li key={event.id} className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowTitle}>{event.title}</p>
              <p className={styles.rowMeta}>
                {statusLabel(event.status)} · {formatWhen(event.startsAt)} · {event.venue?.name ?? 'Sin recinto'}
              </p>
            </div>
            <p className={styles.figure}>
              {event.totalCapacity > 0 ? formatNumber(event.totalCapacity) : '—'}
            </p>
            <TicketButton variant="ghost" onClick={() => router.push(`/events/${event.id}`)}>
              Abrir
            </TicketButton>
          </li>
        ))}
      </ul>
      {canCreate ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet}>{events.length === 0 ? '' : `${formatNumber(events.length)} en la lista`}</p>
          <TicketButton onClick={() => router.push('/events/new')}>Crear evento</TicketButton>
        </div>
      ) : null}
    </section>
  );
}
