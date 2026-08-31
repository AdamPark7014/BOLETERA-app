'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CURATED_MARKETING_CARDS, type CuratedMarketingCard } from '@boletera/shared';
import { Badge, Button, Card, EmptyState, SearchInput } from '@boletera/ui';
import { EventPosterArt } from './EventPosterArt';
import styles from './EventDiscoveryPanel.module.scss';

export type EventHit = {
  /** Precio final al comprador, cargos e IVA incluidos. Es el que se anuncia. */
  minPriceAllIn?: number;
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: number | string;
  currency: string;
  category?: string | null;
  genre?: string | null;
  description?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  posterAspect?: string | null;
  venue?: { name: string; city: string };
  organization?: { name: string; slug: string };
  offerCount?: number;
};

type SuggestHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  category?: string | null;
  subtitle?: string;
  venue?: { name: string; city: string };
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Concierto',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festival',
  STANDUP: 'Stand-up',
  FAMILY: 'Familiar',
  CINEMA: 'Cine',
  OTHER: 'Evento',
};

const CATEGORY_CHIPS = [
  { key: 'ALL', label: 'Todos', emoji: '✨' },
  { key: 'MUSIC', label: 'Conciertos', emoji: '🎵' },
  { key: 'SPORTS', label: 'Deportes', emoji: '⚽' },
  { key: 'THEATER', label: 'Artes', emoji: '🎭' },
  { key: 'COMEDY', label: 'Comedia', emoji: '😂' },
  { key: 'FESTIVAL', label: 'Festivales', emoji: '🎪' },
] as const;

const LOW_STOCK_THRESHOLD = 30;

type SortKey = 'date' | 'price';
type WhenKey = 'ALL' | 'WEEK' | 'WEEKEND' | 'MONTH';
type InventoryState = 'available' | 'low' | 'sold-out';

function fmtDate(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('es-MX', { day: '2-digit' }),
    month: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''),
    weekday: d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
    time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    full: d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

function fmtPrice(n: number | string) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Consultar';
  return `Desde $${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

function inventoryState(offerCount?: number): InventoryState {
  if (offerCount === 0) return 'sold-out';
  if (offerCount != null && offerCount > 0 && offerCount <= LOW_STOCK_THRESHOLD) return 'low';
  return 'available';
}

export function EventDiscoveryPanel({
  initial,
  compact,
  initialFailed,
  suppressFeaturedHero,
  curatedCards,
}: {
  initial: EventHit[];
  compact?: boolean;
  /** El servidor no pudo traer la cartelera: "vacío" y "falló" no son lo mismo. */
  initialFailed?: boolean;
  /** En la home el hero de marketing ya ocupa el h1; no duplicar evento destacado. */
  suppressFeaturedHero?: boolean;
  /** CMS; si vacío o ausente, stock compartido. */
  curatedCards?: CuratedMarketingCard[];
}) {
  const marketingCards =
    curatedCards && curatedCards.length > 0 ? curatedCards : CURATED_MARKETING_CARDS;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [city, setCity] = useState(searchParams.get('city') ?? 'ALL');
  const [category, setCategory] = useState(searchParams.get('category') ?? 'ALL');
  const [when, setWhen] = useState<WhenKey>((searchParams.get('when') as WhenKey) || 'ALL');
  const [sort, setSort] = useState<SortKey>('date');
  const [events, setEvents] = useState<EventHit[]>(initial);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCategory(searchParams.get('category') ?? 'ALL');
    setCity(searchParams.get('city') ?? 'ALL');
    const q = searchParams.get('q');
    if (q != null) setQuery(q);
    const w = searchParams.get('when') as WhenKey | null;
    if (w) setWhen(w);
  }, [searchParams]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
        setActiveSuggest(-1);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/discovery/suggest?q=${encodeURIComponent(q)}&limit=8`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as SuggestHit[];
        setSuggestions(data);
        setSuggestOpen(data.length > 0);
        setActiveSuggest(-1);
      } catch {
        /* las sugerencias son auxiliares: el formulario sigue funcionando */
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (city !== 'ALL') params.set('city', city);
    if (category !== 'ALL') params.set('category', category);
    if (when !== 'ALL') params.set('when', when);
    params.set('limit', '60');

    const isDefault =
      !query.trim() && city === 'ALL' && category === 'ALL' && when === 'ALL';
    if (isDefault && !reloadKey) {
      setEvents(initial);
      setFetchFailed(Boolean(initialFailed));
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/discovery/events?${params}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('discovery');
        setEvents(await res.json());
        setFetchFailed(false);
      } catch {
        // Nos quedamos con lo anterior en pantalla y avisamos qué pasó.
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, city, category, when, initial, initialFailed, reloadKey]);

  const cityStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of initial) {
      const c = e.venue?.city;
      if (!c) continue;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [initial]);

  const filtered = useMemo(() => {
    return [...events].sort((a, b) => {
      if (sort === 'price') return Number(a.minPrice) - Number(b.minPrice);
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
  }, [events, sort]);

  const isFiltering = Boolean(query.trim()) || city !== 'ALL' || category !== 'ALL' || when !== 'ALL';
  const featured =
    !compact && !isFiltering && !suppressFeaturedHero ? filtered[0] : null;
  const list = featured ? filtered.slice(1) : filtered;
  const showCuratedEmpty =
    !isFiltering && !compact && filtered.length === 0 && !loading && !fetchFailed;

  /*
   * Un único h1 por página. En la home, HomeHero lleva el h1; aquí siempre h2.
   * En otras rutas, el evento destacado o el encabezado de lista asumen el h1.
   */
  const ListHeading: ElementType =
    compact || featured || suppressFeaturedHero ? 'h2' : 'h1';

  function pushParams(next: { q?: string; city?: string; category?: string; when?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const apply = (key: string, value: string | undefined, empty = 'ALL') => {
      if (value == null) return;
      if (!value || value === empty) params.delete(key);
      else params.set(key, value);
    };
    apply('q', next.q, '');
    apply('city', next.city);
    apply('category', next.category);
    apply('when', next.when);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function clearFilters() {
    setQuery('');
    setCity('ALL');
    setCategory('ALL');
    setWhen('ALL');
    setEvents(initial);
    setFetchFailed(Boolean(initialFailed));
    setSuggestions([]);
    setSuggestOpen(false);
    router.replace(pathname, { scroll: false });
  }

  function pickSuggest(hit: SuggestHit) {
    setSuggestOpen(false);
    setQuery(hit.title);
    router.push(`/events/${hit.slug}`);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggest((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggest((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
      setActiveSuggest(-1);
    } else if (e.key === 'Enter' && activeSuggest >= 0) {
      e.preventDefault();
      pickSuggest(suggestions[activeSuggest]);
    }
  }

  const countLabel = loading
    ? 'Buscando…'
    : `${filtered.length} evento${filtered.length === 1 ? '' : 's'}${
        city !== 'ALL' ? ` en ${city}` : ''
      }${category !== 'ALL' ? ` · ${CATEGORY_LABEL[category] ?? category}` : ''}`;

  return (
    <div className={compact ? styles.compact : styles.wrap}>
      {featured && (
        <Link href={`/events/${featured.slug}`} className={styles.hero}>
          <div className={styles.heroMedia}>
            <EventPosterArt event={featured} size="hero" priority />
          </div>
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className={styles.brandMark}>BOLETERA</p>
            <h1>{featured.title}</h1>
            <p className={styles.heroSupport}>
              {fmtDate(featured.startsAt).full} · {fmtDate(featured.startsAt).time}
              {featured.venue?.name ? ` · ${featured.venue.name}` : ''}
              {featured.venue?.city ? `, ${featured.venue.city}` : ''}
            </p>
            <div className={styles.heroCta}>
              <span className={styles.cta}>Comprar boletos</span>
              <span className={styles.heroPrice}>{fmtPrice(featured.minPrice)}</span>
            </div>
          </div>
        </Link>
      )}

      <div className={styles.shell}>
        {!featured && (
          <p className={styles.trust}>
            <span>Boletos oficiales</span>
            <span aria-hidden="true">·</span>
            <span>Inventario en tiempo real</span>
            <span aria-hidden="true">·</span>
            <span>Pagos Banorte</span>
          </p>
        )}

        <form
          className={styles.searchForm}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSuggestOpen(false);
            pushParams({ q: query, city, category, when });
          }}
        >
          <Card variant="elevated" padding="sm" className={styles.searchBar}>
            <div className={styles.searchRow}>
              <div className={styles.searchField} ref={searchWrapRef}>
                <SearchInput
                  id="discovery-search"
                  className={styles.searchInput}
                  value={query}
                  onValueChange={setQuery}
                  inputSize="lg"
                  fullWidth
                  placeholder="Ej. Rock, Monterrey, Auditorio Nacional"
                  label="Buscar eventos, recintos o ciudades"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestOpen}
                  aria-controls="discovery-suggest"
                  aria-activedescendant={
                    activeSuggest >= 0 ? `discovery-suggest-${activeSuggest}` : undefined
                  }
                  onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
                  onKeyDown={onSearchKeyDown}
                />
                {suggestOpen && suggestions.length > 0 && (
                  <ul
                    id="discovery-suggest"
                    className={styles.suggest}
                    role="listbox"
                    aria-label="Sugerencias de búsqueda"
                  >
                    {suggestions.map((s, i) => {
                      const d = fmtDate(s.startsAt);
                      return (
                        <li
                          key={s.id}
                          id={`discovery-suggest-${i}`}
                          role="option"
                          aria-selected={i === activeSuggest}
                        >
                          <button
                            type="button"
                            className={
                              i === activeSuggest ? styles.suggestActive : styles.suggestItem
                            }
                            onMouseEnter={() => setActiveSuggest(i)}
                            onClick={() => pickSuggest(s)}
                          >
                            <strong>{s.title}</strong>
                            <span>
                              {d.full} · {d.time}
                              {s.subtitle ? ` · ${s.subtitle}` : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <label htmlFor="discovery-when" className="sr-only">
                Filtrar por fecha
              </label>
              <select
                id="discovery-when"
                className={styles.whenSelect}
                value={when}
                onChange={(e) => {
                  const v = e.target.value as WhenKey;
                  setWhen(v);
                  pushParams({ q: query, city, category, when: v });
                }}
              >
                <option value="ALL">Cualquier fecha</option>
                <option value="WEEK">Esta semana</option>
                <option value="WEEKEND">Fin de semana</option>
                <option value="MONTH">Próximos 30 días</option>
              </select>
            </div>
          </Card>
        </form>

        {cityStats.length > 0 && (
          <div className={styles.cityHubs} role="group" aria-label="Filtrar por ciudad">
            <button
              type="button"
              className={city === 'ALL' ? styles.hubActive : styles.hub}
              aria-pressed={city === 'ALL'}
              onClick={() => {
                setCity('ALL');
                pushParams({ q: query, city: 'ALL', category, when });
              }}
            >
              Todo México
              <Badge tone={city === 'ALL' ? 'accent' : 'neutral'} variant="solid" size="sm">
                {initial.length}
              </Badge>
            </button>
            {cityStats.map((c) => (
              <button
                key={c.name}
                type="button"
                className={city === c.name ? styles.hubActive : styles.hub}
                aria-pressed={city === c.name}
                onClick={() => {
                  setCity(c.name);
                  pushParams({ q: query, city: c.name, category, when });
                }}
              >
                {c.name}
                <Badge
                  tone={city === c.name ? 'accent' : 'neutral'}
                  variant="solid"
                  size="sm"
                >
                  {c.count}
                </Badge>
              </button>
            ))}
          </div>
        )}

        <div className={styles.catHubs} role="group" aria-label="Filtrar por categoría">
          {CATEGORY_CHIPS.map((c) => {
            const active = c.key === 'ALL' ? category === 'ALL' : category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                className={active ? styles.catActive : styles.cat}
                aria-pressed={active}
                onClick={() => {
                  setCategory(c.key);
                  pushParams({ q: query, city, category: c.key, when });
                }}
              >
                <span className={styles.catEmoji} aria-hidden="true">{c.emoji}</span>
                {c.label}
              </button>
            );
          })}
        </div>

        <section className={styles.listSection} aria-label="Eventos">
          <div className={styles.listHead}>
            <div className={styles.listTitleWrap}>
              <ListHeading className={styles.listTitle}>
                {isFiltering ? 'Resultados' : 'Próximos eventos'}
              </ListHeading>
              <span className={styles.listTitleAccent} aria-hidden="true" />
              {/* aria-live: al cambiar filtros el lector anuncia cuántos quedan. */}
              <p className={styles.listCount} role="status" aria-live="polite">
                {countLabel}
              </p>
            </div>
            <div className={styles.listTools}>
              {isFiltering && (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
              <label htmlFor="discovery-sort" className="sr-only">
                Ordenar resultados
              </label>
              <select
                id="discovery-sort"
                className={styles.sort}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="date">Por fecha</option>
                <option value="price">Por precio</option>
              </select>
            </div>
          </div>

          {fetchFailed && (
            <EmptyState
              illustration="error"
              tone="danger"
              title="No pudimos cargar la cartelera"
              description="Revisa tu conexión e inténtalo otra vez. Si el problema sigue, vuelve en unos minutos."
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                  Reintentar
                </Button>
              }
              className={styles.notice}
            />
          )}

          {!isFiltering && !compact ? (
            <ul className={styles.posterGrid} aria-busy={loading}>
              {list.map((e, idx) => {
                const d = fmtDate(e.startsAt);
                const stock = inventoryState(e.offerCount);
                const categoryLabel = CATEGORY_LABEL[e.category || ''] ?? 'Evento';
                return (
                  <li
                    key={e.id}
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                    className={styles.posterItem}
                  >
                    <Link
                      href={`/events/${e.slug}`}
                      className={stock === 'sold-out' ? styles.posterCardSoldOut : styles.posterCard}
                    >
                      <div className={styles.posterChrome}>
                        <div className={styles.posterBadges}>
                          <Badge tone="accent" variant="solid" size="sm">
                            {categoryLabel}
                          </Badge>
                          {stock === 'low' ? (
                            <Badge tone="warning" variant="solid" size="sm">
                              Últimos boletos
                            </Badge>
                          ) : null}
                          {stock === 'sold-out' ? (
                            <Badge tone="neutral" variant="solid" size="sm">
                              Agotado
                            </Badge>
                          ) : null}
                        </div>
                        <div className={styles.posterArt}>
                          <EventPosterArt event={e} size="lg" showDate />
                        </div>
                        {stock === 'sold-out' ? (
                          <div className={styles.posterSoldOverlay} aria-hidden="true" />
                        ) : null}
                      </div>
                      <div className={styles.posterBody}>
                        <h3>{e.title}</h3>
                        <p>
                          {d.weekday} {d.day} {d.month} · {d.time}
                          {e.venue?.city ? ` · ${e.venue.city}` : ''}
                        </p>
                        <span className={styles.posterPrice}>{fmtPrice(e.minPrice)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className={styles.list} aria-busy={loading}>
              {list.map((e) => {
                const d = fmtDate(e.startsAt);
                const stock = inventoryState(e.offerCount);
                return (
                  <li key={e.id}>
                    <Link href={`/events/${e.slug}`} className={styles.row}>
                      <EventPosterArt event={e} size="md" />
                      <time dateTime={e.startsAt} className={styles.rowDate}>
                        <span className={styles.rowWeekday}>{d.weekday}</span>
                        <strong>{d.day}</strong>
                        <span className={styles.rowMonth}>{d.month}</span>
                      </time>
                      <div className={styles.rowMain}>
                        <div className={styles.rowBadges}>
                          <Badge tone="accent" variant="soft" size="sm">
                            {CATEGORY_LABEL[e.category || ''] ?? 'Evento'}
                          </Badge>
                          {stock === 'low' ? (
                            <Badge tone="warning" variant="solid" size="sm">
                              Últimos boletos
                            </Badge>
                          ) : null}
                          {stock === 'sold-out' ? (
                            <Badge tone="neutral" variant="solid" size="sm">
                              Agotado
                            </Badge>
                          ) : null}
                        </div>
                        <h3>{e.title}</h3>
                        <p>
                          {e.venue?.name}
                          {e.venue?.city ? ` · ${e.venue.city}` : ''}
                          <span className={styles.rowDot}>·</span>
                          {d.time}
                        </p>
                      </div>
                      <div className={styles.rowSide}>
                        <span className={styles.rowPrice}>{fmtPrice(e.minPrice)}</span>
                        <span className={styles.rowCta}>Boletos</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {showCuratedEmpty && (
            <div className={styles.curated}>
              <EmptyState
                illustration="seats"
                size="lg"
                title="Todavía no hay eventos publicados"
                description="Mientras tanto, explora por categoría:"
                className={styles.curatedEmpty}
              />
              <ul className={styles.curatedGrid} aria-label="Destacados">
                {marketingCards.map((card) => (
                  <li key={`${card.href}-${card.title}`}>
                    <Link href={card.href} className={styles.curatedCard}>
                      <div className={styles.curatedArt}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={card.image} alt="" loading="lazy" decoding="async" />
                        <div className={styles.curatedShade} aria-hidden="true" />
                      </div>
                      <div className={styles.curatedBody}>
                        <Badge tone="accent" variant="solid" size="sm">Destacado</Badge>
                        <h3>{card.title}</h3>
                        <p>{card.subtitle}</p>
                        <span className={styles.curatedCta}>Explorar →</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filtered.length === 0 && !loading && !fetchFailed && isFiltering && (
            <EmptyState
              illustration="search"
              title="Ningún evento coincide"
              description="Prueba con otra ciudad, otra fecha o quita algún filtro para ver toda la cartelera."
              action={
                <Button type="button" variant="primary" size="sm" onClick={clearFilters}>
                  Ver toda la cartelera
                </Button>
              }
              className={styles.empty}
            />
          )}
        </section>
      </div>
    </div>
  );
}
