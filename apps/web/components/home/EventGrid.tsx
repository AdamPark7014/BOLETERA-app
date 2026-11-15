'use client';

import { useEffect, useMemo, useState } from 'react';
import { advertisedPrice, localDay } from '@/lib/event-display';
import { EventCard, type CardEvent } from './EventCard';
import styles from './home.module.scss';

type Filter = 'all' | 'today' | 'weekend' | 'cheap';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'today', label: 'Hoy' },
  { key: 'weekend', label: 'Fin de semana' },
  { key: 'cheap', label: 'Menos de $500' },
];

function weekendKeys(now: Date): Set<string> {
  const today = localDay(now);
  // Viernes a domingo de esta semana; si ya es fin de semana, el que corre.
  const back = today.weekday === 6 ? 1 : today.weekday === 0 ? 2 : -((5 - today.weekday + 7) % 7);
  const friday = new Date(now.getTime() - back * 86_400_000);
  return new Set([0, 1, 2].map((d) => localDay(new Date(friday.getTime() + d * 86_400_000)).key));
}

/** Cartelera con chips de filtro (sobre lo que ya bajó del API). */
export function EventGrid({
  events,
  kicker = '★ Cartelera ★',
  title,
  failed = false,
  emptyText = 'No hay funciones publicadas por ahora.',
  id = 'cartelera',
  headingLevel = 2,
}: {
  events: CardEvent[];
  kicker?: string;
  title: string;
  failed?: boolean;
  emptyText?: string;
  id?: string;
  headingLevel?: 1 | 2;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  const list = useMemo(() => {
    if (filter === 'all' || !now) return events;
    if (filter === 'cheap') {
      return events.filter((e) => {
        const p = advertisedPrice(e);
        return p > 0 && p < 500;
      });
    }
    if (filter === 'today') {
      const key = localDay(now).key;
      return events.filter((e) => localDay(new Date(e.startsAt)).key === key);
    }
    const keys = weekendKeys(now);
    return events.filter((e) => keys.has(localDay(new Date(e.startsAt)).key));
  }, [events, filter, now]);

  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitles}>
          <span className={styles.kicker}>{kicker}</span>
          <Heading className={styles.h2} id={`${id}-title`}>
            {title}
          </Heading>
        </div>
        <div className={styles.chips} role="group" aria-label="Filtrar cartelera">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className={styles.empty} role="alert">
          No se cargó la cartelera. Revisa tu conexión y recarga la página.
        </p>
      ) : list.length === 0 ? (
        <p className={styles.empty}>
          {filter === 'all' ? emptyText : 'Nada con ese filtro. Prueba con «Todo».'}
        </p>
      ) : (
        <ul className={styles.grid}>
          {list.map((event) => (
            <li key={event.id}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
