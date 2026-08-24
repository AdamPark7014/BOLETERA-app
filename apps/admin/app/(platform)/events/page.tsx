'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  SkeletonCard,
  type BadgeTone,
} from '@boletera/ui';
import { listEvents, type EventRow } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from './_shared/api-state';
import styles from './events.module.scss';

type StatusFilter = 'ALL' | 'LIVE' | 'SCHEDULED' | 'DRAFT' | 'COMPLETED';

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'LIVE', label: 'En vivo' },
  { value: 'SCHEDULED', label: 'Programados' },
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'COMPLETED', label: 'Finalizados' },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programado',
  LIVE: 'En vivo',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'LIVE':
      return 'success';
    case 'SCHEDULED':
      return 'info';
    case 'DRAFT':
      return 'warning';
    default:
      return 'neutral';
  }
}

function formatEventDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
  };
}

function eventKind(event: EventRow): string {
  const kind = (event.metadata as { eventKind?: string } | undefined)?.eventKind;
  return kind && kind !== 'single' ? kind : 'Evento único';
}

export default function EventsPage() {
  const session = useSession();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);
  const token = session.token;

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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return events.filter((event) => {
      if (filter !== 'ALL' && event.status !== filter) return false;
      if (!query) return true;
      return (
        event.title.toLowerCase().includes(query) ||
        event.slug.toLowerCase().includes(query) ||
        event.venue?.name?.toLowerCase().includes(query)
      );
    });
  }, [events, filter, q]);

  const counts = useMemo(
    () => ({
      ALL: events.length,
      LIVE: events.filter((e) => e.status === 'LIVE').length,
      SCHEDULED: events.filter((e) => e.status === 'SCHEDULED').length,
      DRAFT: events.filter((e) => e.status === 'DRAFT').length,
      COMPLETED: events.filter((e) => e.status === 'COMPLETED').length,
    }),
    [events],
  );

  const filterSegments = useMemo(
    () =>
      STATUS_FILTERS.map((item) => ({
        value: item.value,
        label: `${item.label} (${counts[item.value]})`,
      })),
    [counts],
  );

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="listar los eventos de tu organización"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Catálogo"
        title="Eventos"
        description={`${events.length} en total · ${counts.LIVE} en vivo · ${counts.SCHEDULED} programados`}
        actions={
          <Link href="/events/new" className={styles.primaryAction}>
            Crear evento
          </Link>
        }
      />

      <div className={styles.toolbar}>
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Buscar por título, slug o venue…"
          className={styles.search}
          aria-label="Buscar eventos"
        />
        <SegmentedControl
          label="Estado"
          size="sm"
          options={filterSegments}
          value={filter}
          onValueChange={(value) => setFilter(value as StatusFilter)}
          className={styles.filters}
        />
      </div>

      {loading ? (
        <div className={styles.grid} aria-busy="true" aria-label="Cargando eventos">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={events.length === 0 ? 'Aún no hay eventos' : 'Sin resultados'}
          description={
            events.length === 0
              ? 'Crea tu primer evento para configurar mapa, boletos y canales de venta.'
              : 'Prueba otro filtro o término de búsqueda.'
          }
          action={
            events.length === 0 ? (
              <Link href="/events/new" className={styles.primaryAction}>
                Crear evento
              </Link>
            ) : (
              <Button type="button" variant="outline" onClick={() => { setQ(''); setFilter('ALL'); }}>
                Limpiar filtros
              </Button>
            )
          }
        />
      ) : (
        <ul className={styles.grid}>
          {filtered.map((event) => {
            const when = formatEventDate(event.startsAt);
            const orders = event._count?.orders ?? 0;
            const capacity = event.totalCapacity ?? 0;
            const fill = capacity > 0 ? Math.round((orders / capacity) * 100) : 0;

            return (
              <li key={event.id}>
                <article className={styles.card}>
                  <Link href={`/events/${event.id}`} className={styles.posterLink}>
                    {event.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={event.image} alt="" className={styles.posterImg} loading="lazy" />
                    ) : (
                      <div className={styles.posterFallback} aria-hidden>
                        <span>{event.title.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <Badge tone={statusTone(event.status)} variant="soft" size="sm" className={styles.statusBadge}>
                      {STATUS_LABEL[event.status] ?? event.status}
                    </Badge>
                  </Link>

                  <div className={styles.cardBody}>
                    <div className={styles.cardHead}>
                      <h2>
                        <Link href={`/events/${event.id}`}>{event.title}</Link>
                      </h2>
                      <p className={styles.slug}>{event.slug}</p>
                    </div>

                    <dl className={styles.meta}>
                      <div>
                        <dt>Fecha</dt>
                        <dd>
                          {when.date}
                          <span>{when.time}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Venue</dt>
                        <dd>{event.venue?.name ?? 'Sin venue'}</dd>
                      </div>
                      <div>
                        <dt>Tipo</dt>
                        <dd>{eventKind(event)}</dd>
                      </div>
                    </dl>

                    <div className={styles.metrics}>
                      <div className={styles.metric}>
                        <span className={styles.metricLabel}>Órdenes</span>
                        <strong>{orders.toLocaleString('es-MX')}</strong>
                      </div>
                      <div className={styles.metric}>
                        <span className={styles.metricLabel}>Capacidad</span>
                        <strong>{capacity > 0 ? capacity.toLocaleString('es-MX') : '—'}</strong>
                      </div>
                      <div className={styles.metric}>
                        <span className={styles.metricLabel}>Ocupación</span>
                        <strong>{capacity > 0 ? `${fill}%` : '—'}</strong>
                      </div>
                    </div>

                    {capacity > 0 ? (
                      <div className={styles.progress} aria-hidden>
                        <span style={{ width: `${Math.min(100, fill)}%` }} />
                      </div>
                    ) : null}

                    <div className={styles.cardActions}>
                      <Link href={`/events/${event.id}`} className={styles.secondaryAction}>
                        Gestionar
                      </Link>
                      <Link href={`/events/${event.id}#tickets`} className={styles.ghostAction}>
                        Boletos
                      </Link>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
