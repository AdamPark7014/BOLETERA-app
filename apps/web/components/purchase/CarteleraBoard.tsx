'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import styles from './purchase.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const CATEGORIES = [
  { key: 'ALL', label: 'Todas' },
  { key: 'MUSIC', label: 'Concierto' },
  { key: 'SPORTS', label: 'Deportes' },
  { key: 'THEATER', label: 'Teatro' },
  { key: 'COMEDY', label: 'Comedia' },
  { key: 'CONFERENCE', label: 'Conferencia' },
  { key: 'WORKSHOP', label: 'Taller' },
  { key: 'FESTIVAL', label: 'Festival' },
  { key: 'FAMILY', label: 'Familiar' },
  { key: 'STANDUP', label: 'Stand-up' },
  { key: 'CINEMA', label: 'Cine' },
  { key: 'OTHER', label: 'Evento' },
] as const;

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

function advertised(event: EventHit): number {
  const raw = event.minPriceAllIn ?? event.minPrice;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function whenLabel(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function CarteleraBoard({
  initial,
  initialFailed = false,
  headline,
  subcopy,
  presetCategory = 'ALL',
  presetCity = 'ALL',
}: {
  initial: EventHit[];
  initialFailed?: boolean;
  headline: string;
  subcopy?: string;
  presetCategory?: string;
  presetCity?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(presetCategory);
  const [city, setCity] = useState(presetCity);
  const [sort, setSort] = useState<'date' | 'price'>('date');
  const [events, setEvents] = useState(initial);
  const [failed, setFailed] = useState(initialFailed);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<'category' | 'city' | null>(null);
  const [cityQuery, setCityQuery] = useState('');

  const cities = useMemo(() => {
    const names = new Set<string>();
    for (const event of initial) {
      if (event.venue?.city) names.add(event.venue.city);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es-MX'));
  }, [initial]);

  useEffect(() => {
    const preset =
      !query.trim() && category === presetCategory && city === presetCity && !reloadKey;
    if (preset) {
      setEvents(initial);
      setFailed(initialFailed);
      return;
    }
    const params = new URLSearchParams({ limit: '60' });
    if (query.trim()) params.set('q', query.trim());
    if (category !== 'ALL') params.set('category', category);
    if (city !== 'ALL') params.set('city', city);
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/discovery/events?${params}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('discovery');
        setEvents(await res.json());
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query, category, city, initial, initialFailed, presetCategory, presetCity, reloadKey]);

  const list = useMemo(() => {
    return [...events].sort((a, b) => {
      if (sort === 'price') return advertised(a) - advertised(b);
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
  }, [events, sort]);

  useEffect(() => {
    setActive(0);
  }, [list.length, sort, category, city, query]);

  const current = list[active];
  const filtering = Boolean(query.trim()) || category !== 'ALL' || city !== 'ALL';
  const visibleCities = cities.filter((name) =>
    name.toLocaleLowerCase('es-MX').includes(cityQuery.trim().toLocaleLowerCase('es-MX')),
  );

  function open(event: EventHit | undefined) {
    if (!event) return;
    router.push(`/events/${event.slug}`);
  }

  return (
    <div className={styles.column}>
      <header className={styles.stack}>
        <h1 className={styles.title}>{headline}</h1>
        {subcopy ? <p className={styles.lead}>{subcopy}</p> : null}
      </header>

      <Field
        label="Buscar"
        kind="search"
        value={query}
        placeholder="Artista, ciudad o recinto"
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className={styles.tools}>
        <div className={styles.segment} role="group" aria-label="Orden">
          <button type="button" aria-pressed={sort === 'date'} onClick={() => setSort('date')}>
            Fecha
          </button>
          <button type="button" aria-pressed={sort === 'price'} onClick={() => setSort('price')}>
            Precio
          </button>
        </div>
        <button type="button" className={styles.textButton} onClick={() => setSheet('category')}>
          {category === 'ALL' ? 'Categoría' : CATEGORY_LABEL[category] ?? category}
        </button>
        <button type="button" className={styles.textButton} onClick={() => setSheet('city')}>
          {city === 'ALL' ? 'Ciudad' : city}
        </button>
      </div>

      {failed ? (
        <div className={styles.error} role="alert">
          <span>No se cargó la cartelera.</span>
          <span>Revisa la conexión.</span>
          <TicketButton type="button" variant="secondary" onClick={() => setReloadKey((n) => n + 1)}>
            Reintentar
          </TicketButton>
        </div>
      ) : null}

      {!failed && !loading && list.length === 0 ? (
        <p className={styles.lead}>
          {filtering ? 'Nada con ese criterio.' : 'No hay funciones publicadas.'}
        </p>
      ) : null}

      <ul
        className={styles.list}
        aria-label="Cartelera"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(list.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(current);
          }
        }}
      >
        {list.map((event, index) => {
          const price = advertised(event);
          return (
            <li key={event.id}>
              <button
                type="button"
                className={styles.cardButton}
                aria-current={index === active ? 'true' : undefined}
                onClick={() => setActive(index)}
                onDoubleClick={() => open(event)}
              >
                {event.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.thumb} src={event.image} alt="" />
                ) : (
                  <span className={styles.thumb} />
                )}
                <span className={styles.copy}>
                  <span className={styles.caption}>
                    {CATEGORY_LABEL[event.category || ''] ?? 'Evento'}
                  </span>
                  <strong>{event.title}</strong>
                  <span className={styles.meta}>
                    {whenLabel(event.startsAt)}
                    {event.venue?.name ? ` · ${event.venue.name}` : ''}
                    {event.venue?.city ? ` · ${event.venue.city}` : ''}
                  </span>
                </span>
                {price > 0 ? (
                  <span className={styles.price}>Desde {formatTicketAmount(price)}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          <p className={styles.dockSummary}>{current ? current.title : 'Ninguna función'}</p>
          <TicketButton type="button" disabled={!current || loading} onClick={() => open(current)}>
            Ver función
          </TicketButton>
        </div>
      </div>

      {sheet ? (
        <div className={styles.sheet} role="presentation" onClick={() => setSheet(null)}>
          <div
            className={styles.sheetPanel}
            role="dialog"
            aria-label={sheet === 'category' ? 'Categoría' : 'Ciudad'}
            onClick={(event) => event.stopPropagation()}
          >
            <p className={styles.title}>{sheet === 'category' ? 'Categoría' : 'Ciudad'}</p>
            {sheet === 'city' && cities.length > 12 ? (
              <Field
                label="Buscar ciudad"
                kind="search"
                value={cityQuery}
                onChange={(event) => setCityQuery(event.target.value)}
              />
            ) : null}
            {sheet === 'category'
              ? CATEGORIES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={category === item.key}
                    onClick={() => {
                      setCategory(item.key);
                      setSheet(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))
              : (
                  <>
                    <button
                      type="button"
                      aria-pressed={city === 'ALL'}
                      onClick={() => {
                        setCity('ALL');
                        setSheet(null);
                      }}
                    >
                      Todas
                    </button>
                    {visibleCities.map((name) => (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={city === name}
                        onClick={() => {
                          setCity(name);
                          setSheet(null);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </>
                )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
