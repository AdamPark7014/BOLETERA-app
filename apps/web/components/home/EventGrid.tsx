'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TicketState } from '@boletera/ui';
import { advertisedPrice, localDay } from '@/lib/event-display';
import { EventCard, type CardEvent } from './EventCard';
import styles from './home.module.scss';

type Filter = 'all' | 'today' | 'weekend' | 'cheap';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'today', label: 'Hoy' },
  { key: 'weekend', label: 'Fin de semana' },
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
  kicker,
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
          {kicker ? <span className={styles.kicker}>{kicker}</span> : null}
          <Heading className={headingLevel === 1 ? styles.pageTitle : styles.h2} id={`${id}-title`}>
            {title}
          </Heading>
        </div>
        {events.length > 0 ? (
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
        ) : null}
      </div>

      {failed ? (
        <TicketState
          kind="error"
          title="No pudimos cargar la cartelera"
          body="Intenta de nuevo en un momento."
          minHeight={320}
        />
      ) : list.length === 0 ? (
        <TicketState
          title={filter === 'all' ? emptyText : 'Nada para estas fechas todavía'}
          minHeight={320}
          action={
            filter === 'all' ? (
              <Link href="/" className="bt-action">
                Ver toda la cartelera
              </Link>
            ) : undefined
          }
        />
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
