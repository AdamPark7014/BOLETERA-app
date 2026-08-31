'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button, SearchInput } from '@boletera/ui';
import { useTenantBrand } from '@/components/TenantBrand';
import styles from './HomeHero.module.scss';

const ROTATE_MS = 7000;
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** Blur neutro mientras llega la foto (evita el vacío negro). */
const HERO_BLUR =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

type HeroSlide = {
  url: string;
  src: string;
  srcMobile: string;
  label: string;
  alt: string;
};

type SuggestHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  subtitle?: string;
};

type HomeHeroProps = {
  slides: readonly HeroSlide[];
  /** Conteo inicial desde el servidor; si no llega, se intenta en cliente. */
  initialEventCount?: number;
  /** Copy CMS; si falta, se usa el texto por defecto de marketplace. */
  headline?: string;
  subcopy?: string;
};

const DEFAULT_HEADLINE = 'Vive la emoción en vivo';
const DEFAULT_SUBCOPY =
  'Boletos oficiales para conciertos, festivales y deportes en todo México. Precio final con cargos incluidos.';

export function HomeHero({
  slides,
  initialEventCount,
  headline,
  subcopy,
}: HomeHeroProps) {
  const router = useRouter();
  const brand = useTenantBrand();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const [eventCount, setEventCount] = useState<number | null>(initialEventCount ?? null);
  const searchRef = useRef<HTMLDivElement>(null);
  const slideCount = slides.length;

  const goTo = useCallback(
    (next: number) => {
      setIndex(((next % slideCount) + slideCount) % slideCount);
    },
    [slideCount],
  );

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => goNext(), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, goNext]);

  /* Precarga la diapositiva siguiente en segundo plano. */
  useEffect(() => {
    const next = (index + 1) % slideCount;
    const img = new window.Image();
    img.src = slides[next].src;
  }, [index, slideCount, slides]);

  useEffect(() => {
    if (initialEventCount != null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/discovery/events?limit=60`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as unknown[];
        if (!cancelled && Array.isArray(data)) setEventCount(data.length);
      } catch {
        /* fallback estático en copy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialEventCount]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) {
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
          `${API}/discovery/suggest?q=${encodeURIComponent(q)}&limit=6`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as SuggestHit[];
        setSuggestions(data);
        setSuggestOpen(data.length > 0);
        setActiveSuggest(-1);
      } catch {
        /* la búsqueda sigue enviando al formulario */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function pickSuggest(hit: SuggestHit) {
    setSuggestOpen(false);
    setQuery('');
    router.push(`/events/${hit.slug}`);
  }

  function focusCarteleraSearch() {
    const el = document.getElementById('discovery-search') as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    setSuggestOpen(false);
    if (!q) {
      if (!focusCarteleraSearch()) {
        document.getElementById('cartelera')?.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    if (activeSuggest >= 0 && suggestions[activeSuggest]) {
      pickSuggest(suggestions[activeSuggest]);
      return;
    }
    router.push(`/?q=${encodeURIComponent(q)}#cartelera`);
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
    }
  }

  const active = slides[index];
  const proofCount = eventCount != null && eventCount > 0 ? eventCount : 50;
  const nextIndex = (index + 1) % slideCount;

  return (
    <section
      className={styles.hero}
      aria-label={`Bienvenida a ${brand.name}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div
        className={styles.slides}
        aria-hidden="true"
        style={{ backgroundImage: `url(${slides[0].src})` }}
      >
        {slides.map((slide, i) => {
          const visible = i === index || i === nextIndex;
          if (!visible) return null;

          return (
            <div
              key={slide.url}
              className={
                i === index
                  ? `${styles.slideWrap} ${styles.slideActive}`
                  : styles.slideWrap
              }
            >
              <Image
                src={slide.src}
                alt=""
                fill
                priority={i === 0}
                fetchPriority={i === index ? 'high' : 'low'}
                sizes="100vw"
                quality={75}
                unoptimized={!slide.src.startsWith('/')}
                placeholder="blur"
                blurDataURL={HERO_BLUR}
                className={styles.slideImg}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.bottomFade} aria-hidden="true" />

      <div className={styles.copy}>
        <p className={styles.brandMark}>{brand.name}</p>
        <h1>{headline?.trim() || DEFAULT_HEADLINE}</h1>
        <p className={styles.subcopy}>{subcopy?.trim() || DEFAULT_SUBCOPY}</p>

        <div className={styles.searchBlock} ref={searchRef}>
          <form className={styles.searchForm} onSubmit={onSubmit} role="search">
            <SearchInput
              id="hero-search"
              value={query}
              onValueChange={setQuery}
              placeholder="Busca artista, ciudad o recinto"
              label="Buscar eventos"
              inputSize="lg"
              className={styles.searchInput}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestOpen}
              aria-controls="hero-suggest"
              aria-activedescendant={
                activeSuggest >= 0 ? `hero-suggest-${activeSuggest}` : undefined
              }
              onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
              onKeyDown={onSearchKeyDown}
            />
            <Button type="submit" size="lg" className={styles.searchBtn}>
              Buscar
            </Button>
          </form>
          {suggestOpen && suggestions.length > 0 && (
            <ul id="hero-suggest" className={styles.suggest} role="listbox" aria-label="Sugerencias">
              {suggestions.map((s, i) => (
                <li
                  key={s.id}
                  id={`hero-suggest-${i}`}
                  role="option"
                  aria-selected={i === activeSuggest}
                >
                  <button
                    type="button"
                    className={i === activeSuggest ? styles.suggestActive : styles.suggestItem}
                    onMouseEnter={() => setActiveSuggest(i)}
                    onClick={() => pickSuggest(s)}
                  >
                    <strong>{s.title}</strong>
                    <span>{s.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.socialProof} aria-label="Eventos disponibles">
          <span className={styles.proofBadge}>+{proofCount}</span>
          <span className={styles.proofText}>
            eventos activos en cartelera
            {eventCount == null ? ' · actualizando' : ''}
          </span>
        </div>

        <div className={styles.ctas}>
          <Link href="/categoria/MUSIC" className={styles.ctaPrimary}>
            Explorar conciertos
          </Link>
          <a href="#cartelera" className={styles.ctaSecondary}>
            Ver cartelera
          </a>
        </div>

        <ul className={styles.trust} aria-label="Garantías">
          <li>Boletos oficiales</li>
          <li>Inventario en tiempo real</li>
          <li>Pagos seguros</li>
        </ul>
      </div>

      <div className={styles.controls} aria-label="Controles del carrusel">
        <button
          type="button"
          className={styles.navBtn}
          onClick={goPrev}
          aria-label="Diapositiva anterior"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path
              d="M14 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className={styles.dots} role="tablist" aria-label="Diapositivas del hero">
          {slides.map((slide, i) => (
            <button
              key={slide.url}
              type="button"
              role="tab"
              className={i === index ? styles.dotActive : styles.dot}
              aria-selected={i === index}
              aria-label={slide.label}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        <button
          type="button"
          className={styles.navBtn}
          onClick={goNext}
          aria-label="Diapositiva siguiente"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path
              d="M10 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <p className={styles.slideLabel} aria-live="polite">
        {active.label}
      </p>
    </section>
  );
}
