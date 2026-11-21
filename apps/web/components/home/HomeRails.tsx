'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TicketState } from '@boletera/ui';
import { CATEGORY_LABEL, availability } from '@/lib/event-display';
import { EventCard, type CardEvent } from './EventCard';
import styles from './home.module.scss';

function withinWeek(events: CardEvent[], now: Date): CardEvent[] {
  const end = now.getTime() + 7 * 86_400_000;
  return events.filter((e) => {
    const t = new Date(e.startsAt).getTime();
    return t >= now.getTime() - 3_600_000 && t <= end;
  });
}

function scarceEvents(events: CardEvent[]): CardEvent[] {
  return events
    .map((e) => ({ e, stock: availability(e.offers) }))
    .filter(({ stock }) => !stock.soldOut && stock.remaining != null && stock.remaining <= 100)
    .sort((a, b) => (a.stock.remaining ?? 999) - (b.stock.remaining ?? 999))
    .slice(0, 12)
    .map(({ e }) => e);
}

function nearYou(events: CardEvent[]): { city: string; list: CardEvent[] } | null {
  const counts = new Map<string, CardEvent[]>();
  for (const e of events) {
    const city = e.venue?.city?.trim();
    if (!city) continue;
    const list = counts.get(city) ?? [];
    list.push(e);
    counts.set(city, list);
  }
  let best: { city: string; list: CardEvent[] } | null = null;
  for (const [city, list] of counts) {
    if (!best || list.length > best.list.length) best = { city, list: list.slice(0, 12) };
  }
  return best;
}

function Rail({ id, title, events }: { id: string; title: string; events: CardEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2} id={`${id}-title`}>
          {title}
        </h2>
        <Link href="/events" className={styles.railMore}>
          Ver todos
        </Link>
      </div>
      <ul className={styles.rail}>
        {events.map((event) => (
          <li key={event.id} className={styles.railItem}>
            <EventCard event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Carruseles del inicio: esta semana, últimos boletos, cerca de ti y categorías. */
export function HomeRails({ events, failed = false }: { events: CardEvent[]; failed?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  const week = useMemo(() => (now ? withinWeek(events, now) : events.slice(0, 12)), [events, now]);
  const last = useMemo(() => scarceEvents(events), [events]);
  const near = useMemo(() => nearYou(events), [events]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      const key = e.category || 'OTHER';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Object.entries(CATEGORY_LABEL)
      .map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }))
      .filter((c) => c.count > 0);
  }, [events]);

  if (failed) {
    return (
      <TicketState
        kind="error"
        title="No pudimos cargar la cartelera"
        body="Intenta de nuevo en un momento."
        minHeight={280}
      />
    );
  }

  if (events.length === 0) {
    return (
      <TicketState
        title="Pronto habrá funciones"
        body="Mientras tanto revisa membresías o vuelve más tarde."
        minHeight={280}
        action={
          <Link href="/membresias" className="bt-action">
            Ver membresías
          </Link>
        }
      />
    );
  }

  return (
    <>
      <Rail id="semana" title="Esta semana" events={week} />
      <Rail id="ultimos" title="Últimos boletos" events={last} />
      {near ? <Rail id="cerca" title={`Cerca de ti · ${near.city}`} events={near.list} /> : null}

      {categories.length > 0 ? (
        <section className={styles.section} aria-labelledby="cats-title">
          <div className={styles.sectionHead}>
            <h2 className={styles.h2} id="cats-title">
              Explorar
            </h2>
          </div>
          <ul className={styles.catGrid}>
            {categories.map((cat) => (
              <li key={cat.key}>
                <Link href={`/categoria/${cat.key}`} className={styles.catCard}>
                  <span className={styles.catName}>{cat.label}</span>
                  <span className={styles.catCount}>
                    {cat.count} {cat.count === 1 ? 'evento' : 'eventos'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
