'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
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
      <header className={styles.panelHead} style={{ marginBottom: 22 }}>
        <div className={styles.sectionHead} style={{ marginBottom: 0 }}>
          <h1 className={styles.sectionTitle}>Eventos</h1>
          {!loading ? (
            <p className={styles.quiet}>
              {needle
                ? `${formatNumber(filtered.length)} de ${formatNumber(events.length)}`
                : `${formatNumber(events.length)} ${events.length === 1 ? 'evento' : 'eventos'}`}
            </p>
          ) : null}
        </div>
        {canCreate ? (
          <TicketButton onClick={() => router.push('/events/new')}>Crear evento</TicketButton>
        ) : null}
      </header>
      {loading ? (
        <div className={styles.skeleton} style={{ height: 420 }} aria-label="Cargando eventos" />
      ) : null}
      {!loading && events.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Todavía no hay eventos</p>
          <p className={styles.quiet}>
            {canCreate ? 'Crea el primero en un par de minutos.' : 'Aún no hay funciones.'}
          </p>
          {canCreate ? (
            <Link href="/events/new" className={styles.goldLink}>
              Crear evento
            </Link>
          ) : null}
        </div>
      ) : null}
      {!loading && events.length > 0 && filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Ningún evento coincide con la búsqueda</p>
          <p className={styles.quiet}>Prueba con otro nombre.</p>
        </div>
      ) : null}
      {!loading && filtered.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Evento</th>
                <th scope="col">Fecha</th>
                <th scope="col">Estado</th>
                <th scope="col" className={styles.num}>
                  Aforo
                </th>
                <th scope="col">
                  <span className={styles.srOnly}>Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link href={`/events/${event.id}`} className={styles.cellLink}>
                      {event.title}
                    </Link>
                    <p className={styles.rowMeta}>{event.venue?.name ?? 'Sin recinto'}</p>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatWhen(event.startsAt)}</td>
                  <td>
                    <span className={statusChip(event.status)}>{statusLabel(event.status)}</span>
                  </td>
                  <td className={styles.num}>
                    {event.totalCapacity > 0 ? formatNumber(event.totalCapacity) : '—'}
                  </td>
                  <td className={styles.num}>
                    <Link href={`/events/${event.id}`} className={styles.panelLink}>
                      Abrir resumen
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function statusChip(status: string): string {
  if (status === 'LIVE' || status === 'SCHEDULED') return styles.chipOk;
  if (status === 'CANCELLED') return styles.chipDanger;
  if (status === 'DRAFT' || status === 'RESCHEDULED') return styles.chipWarn;
  return styles.chip;
}
