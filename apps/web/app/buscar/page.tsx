'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchBox, SEARCH_EXAMPLES } from '@/components/search/SearchBox';
import { RecommendedForYou } from '@/components/search/RecommendedForYou';
import { EventCard, type CardEvent } from '@/components/home/EventCard';
import styles from './buscar.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Hit = CardEvent & { score?: number; available?: boolean };

function BuscarInner() {
  const params = useSearchParams();
  const initialQ = params.get('q') ?? '';
  const initialCity = params.get('city') ?? '';
  const [q, setQ] = useState(initialQ);
  const [city, setCity] = useState(initialCity);
  const [cities, setCities] = useState<string[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [understood, setUnderstood] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [alternatives, setAlternatives] = useState<Hit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'ready'>('idle');

  useEffect(() => {
    fetch(`${API}/discovery/facets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { cities?: { name: string }[] } | null) => {
        if (data?.cities) setCities(data.cities.map((c) => c.name));
      })
      .catch(() => undefined);
  }, []);

  const run = useCallback(async (query: string, cityName: string) => {
    setQ(query);
    setCity(cityName);
    if (query.trim().length < 2) {
      setState('idle');
      setResults([]);
      setAlternatives([]);
      setChips([]);
      return;
    }
    setState('loading');
    try {
      const sessionId =
        localStorage.getItem('bt-search-session') ||
        (() => {
          const id = `s-${Date.now()}`;
          localStorage.setItem('bt-search-session', id);
          return id;
        })();
      const res = await fetch(`${API}/smart-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, city: cityName || undefined, sessionId }),
      });
      if (!res.ok) throw new Error('fail');
      const data = await res.json();
      setUnderstood(data.understood || '');
      setChips(Array.isArray(data.chips) ? data.chips : []);
      const mapHit = (h: Hit & { startsAt: string | Date }): Hit => ({
        id: h.id,
        slug: h.slug,
        title: h.title,
        startsAt: typeof h.startsAt === 'string' ? h.startsAt : new Date(h.startsAt).toISOString(),
        category: h.category,
        image: h.image,
        minPrice: h.minPrice,
        venue: h.venue,
        score: h.score,
        available: h.available,
      });
      setResults((data.results || []).map(mapHit));
      setAlternatives((data.alternatives || []).map(mapHit));
      const has = (data.results || []).length > 0 || (data.alternatives || []).length > 0;
      setState(has ? 'ready' : 'empty');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (initialQ) void run(initialQ, initialCity);
  }, [initialQ, initialCity, run]);

  function dismissChip(chip: string) {
    const next = chips.filter((c) => c !== chip);
    setChips(next);
    // Re-busca sin ese chip en el texto: quita la etiqueta de la frase mostrada
    const phrase = next.join(' ');
    void run(phrase || q, city);
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" className={styles.main} tabIndex={-1}>
        <header className={styles.hero}>
          <h1 className={styles.title}>Buscar</h1>
          <p className={styles.sub}>Describe lo que buscas con tus palabras.</p>
          <div className={styles.box}>
            <SearchBox
              initialQuery={q}
              initialCity={city}
              cities={cities}
              onSearch={(query, cityName) => {
                const url = new URL(window.location.href);
                url.searchParams.set('q', query);
                if (cityName) url.searchParams.set('city', cityName);
                else url.searchParams.delete('city');
                window.history.replaceState({}, '', url.toString());
                void run(query, cityName);
              }}
            />
          </div>
          {!q ? (
            <ul className={styles.examples}>
              {SEARCH_EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" onClick={() => void run(ex, city)}>
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        {chips.length > 0 ? (
          <div className={styles.chips} aria-label="Cómo se entendió">
            <span className={styles.understood}>{understood}</span>
            <ul>
              {chips.map((chip) => (
                <li key={chip}>
                  <button type="button" onClick={() => dismissChip(chip)} aria-label={`Quitar ${chip}`}>
                    {chip} ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state === 'loading' ? <p className={styles.meta}>Buscando…</p> : null}
        {state === 'error' ? (
          <p className={styles.meta} role="alert">
            No se pudo buscar. Intenta de nuevo.
          </p>
        ) : null}
        {state === 'empty' ? <p className={styles.meta}>No hay resultados para esa búsqueda.</p> : null}

        {results.length > 0 ? (
          <section className={styles.section} aria-label="Resultados">
            <div className={styles.grid}>
              {results.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        ) : null}

        {alternatives.length > 0 ? (
          <section className={styles.section} aria-label="Alternativas">
            <h2 className={styles.h2}>
              {results.length === 0
                ? 'No hay coincidencias exactas; esto hay cerca'
                : 'También te puede interesar'}
            </h2>
            <div className={styles.grid}>
              {alternatives.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        ) : null}

        <RecommendedForYou />
      </main>
    </>
  );
}

export default function BuscarPage() {
  return (
    <Suspense fallback={<div className={styles.main}>Cargando…</div>}>
      <BuscarInner />
    </Suspense>
  );
}
