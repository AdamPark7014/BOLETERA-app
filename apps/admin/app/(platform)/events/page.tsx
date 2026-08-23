'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listEvents, type EventRow } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from './_shared/api-state';
import platform from '../_styles/platform.module.scss';
import styles from './events.module.scss';

const statusClass: Record<string, string> = {
  DRAFT: `${platform.badge} ${platform.draft}`,
  SCHEDULED: `${platform.badge} ${platform.scheduled}`,
  LIVE: `${platform.badge} ${platform.live}`,
  COMPLETED: `${platform.badge} ${platform.completed}`,
};

const FILTERS = [
  { id: 'ALL', label: 'Todos' },
  { id: 'LIVE', label: 'En vivo' },
  { id: 'SCHEDULED', label: 'Programados' },
  { id: 'DRAFT', label: 'Borradores' },
  { id: 'COMPLETED', label: 'Finalizados' },
];

export default function EventsPage() {
  const session = useSession();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);
  const token = session.token;

  useEffect(() => {
    // Sin token todavía no hay nada que pedir; el estado de sesión decide qué
    // pintar. Antes se hacía `if (!token) return` y `loading` se quedaba en true
    // para siempre, dejando el esqueleto de carga como pantalla final.
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
    return events.filter((e) => {
      if (filter !== 'ALL' && e.status !== filter) return false;
      if (q && !e.title.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
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
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Eventos</h1>
          <p>
            {events.length} totales · {counts.LIVE} en vivo · {counts.SCHEDULED} programados
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className={platform.ghostBtn}>
            ↓ Exportar
          </button>
          <Link href="/events/new" className={platform.primaryBtn}>
            + Crear evento
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Buscar eventos por título…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? styles.filterActive : styles.filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className={styles.filterCount}>
                {counts[f.id as keyof typeof counts] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <section className={platform.panel}>
        {loading ? (
          <div className={styles.skeleton}>
            <span /> <span /> <span /> <span />
          </div>
        ) : (
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Fecha</th>
                <th>Venue</th>
                <th>Capacidad</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className={styles.eventCell}>
                      <span className={styles.thumb} aria-hidden>
                        {e.title.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <strong>{e.title}</strong>
                        <small>{e.slug}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{new Date(e.startsAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
                    <br />
                    <small style={{ color: 'var(--bl-gray-500)' }}>
                      {new Date(e.startsAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </td>
                  <td>{e.venue?.name ?? '—'}</td>
                  <td>{e.totalCapacity?.toLocaleString() ?? '—'}</td>
                  <td>
                    <span className={styles.kindPill}>
                      {(e.metadata as { eventKind?: string })?.eventKind ?? 'single'}
                    </span>
                  </td>
                  <td>
                    <span className={statusClass[e.status] ?? platform.badge}>{e.status}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/events/${e.id}`} className={platform.ghostBtn}>
                      Gestionar →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className={styles.empty}>
                      <p>
                        {events.length === 0
                          ? 'Aún no has creado ningún evento.'
                          : 'No hay resultados con los filtros actuales.'}
                      </p>
                      <Link href="/events/new" className={platform.primaryBtn}>
                        + Crear el primero
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
