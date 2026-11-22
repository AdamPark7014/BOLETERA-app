'use client';

import { useEffect, useState } from 'react';
import { EventCard, type CardEvent } from '@/components/home/EventCard';
import styles from './RecommendedForYou.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const VIEWED_KEY = 'bt-viewed-events';

export function rememberViewedEvent(eventId: string) {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [eventId, ...list.filter((id) => id !== eventId)].slice(0, 20);
    localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function RecommendedForYou() {
  const [items, setItems] = useState<CardEvent[]>([]);
  const [state, setState] = useState<'loading' | 'empty' | 'error' | 'ready'>('loading');

  useEffect(() => {
    let alive = true;
    let viewed: string[] = [];
    try {
      viewed = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]') as string[];
    } catch {
      viewed = [];
    }
    fetch(`${API}/smart-search/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewedEventIds: viewed, limit: 8 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          items?: Array<{
            id: string;
            slug: string;
            title: string;
            startsAt: string;
            category?: string;
            image?: string | null;
            minPrice: number | string;
            venue?: { name: string; city: string };
          }>;
        } | null) => {
          if (!alive) return;
          const list = (data?.items || []).map((e) => ({
            ...e,
            startsAt: typeof e.startsAt === 'string' ? e.startsAt : String(e.startsAt),
          }));
          setItems(list);
          setState(list.length ? 'ready' : 'empty');
        }
      )
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <section className={styles.section} aria-busy="true">
        <h2 className={styles.title}>Recomendado para ti</h2>
        <p className={styles.meta}>Cargando…</p>
      </section>
    );
  }
  if (state === 'error') {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Recomendado para ti</h2>
        <p className={styles.meta}>No se pudieron cargar recomendaciones.</p>
      </section>
    );
  }
  if (state === 'empty') return null;

  return (
    <section className={styles.section} aria-labelledby="rec-title">
      <h2 id="rec-title" className={styles.title}>
        Recomendado para ti
      </h2>
      <div className={styles.grid}>
        {items.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
