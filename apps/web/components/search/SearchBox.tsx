'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import styles from './SearchBox.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const RECENT_KEY = 'bt-search-recent';

export const SEARCH_EXAMPLES = [
  'rock este sábado en CDMX por menos de 800',
  'para ir con niños el domingo',
  'boletos baratos para el clásico',
  'teatro mañana en Puebla',
  'festival este fin de semana',
];

type SuggestItem = {
  type: 'event' | 'venue' | 'city' | 'artist' | 'recent' | 'example';
  id?: string;
  slug?: string;
  title: string;
  subtitle?: string;
  href?: string;
};

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

type SearchBoxProps = {
  initialQuery?: string;
  initialCity?: string;
  cities?: string[];
  compact?: boolean;
  onSearch?: (q: string, city: string) => void;
};

export function SearchBox({
  initialQuery = '',
  initialCity = '',
  cities = [],
  compact = false,
  onSearch,
}: SearchBoxProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(initialQuery);
  const [city, setCity] = useState(initialCity);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [active, setActive] = useState(-1);
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [shortPlaceholder, setShortPlaceholder] = useState(false);

  useEffect(() => {
    setVoice(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 479px)');
    const sync = () => setShortPlaceholder(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const buildStatic = useCallback((query: string): SuggestItem[] => {
    const recent = loadRecent()
      .filter((r) => !query || r.toLowerCase().includes(query.toLowerCase()))
      .map((r) => ({ type: 'recent' as const, title: r, href: `/buscar?q=${encodeURIComponent(r)}` }));
    const examples = SEARCH_EXAMPLES.filter(
      (e) => !query || e.toLowerCase().includes(query.toLowerCase())
    ).map((e) => ({
      type: 'example' as const,
      title: e,
      href: `/buscar?q=${encodeURIComponent(e)}`,
    }));
    return [...recent.slice(0, 4), ...examples.slice(0, 3)];
  }, []);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      if (q.trim().length < 2) {
        if (alive) setItems(buildStatic(q));
        return;
      }
      try {
        const res = await fetch(`${API}/smart-search/suggest?q=${encodeURIComponent(q.trim())}`);
        const data = res.ok
          ? await res.json()
          : { events: [], venues: [], cities: [], artists: [] };
        if (!alive) return;
        const next: SuggestItem[] = [
          ...(data.events || []).map(
            (e: { slug: string; title: string; subtitle?: string; id: string }) => ({
              type: 'event' as const,
              id: e.id,
              slug: e.slug,
              title: e.title,
              subtitle: e.subtitle,
              href: `/events/${e.slug}`,
            })
          ),
          ...(data.venues || []).map(
            (v: { slug: string; title: string; subtitle?: string; id: string }) => ({
              type: 'venue' as const,
              id: v.id,
              slug: v.slug,
              title: v.title,
              subtitle: v.subtitle,
              href: `/venues/${v.slug}`,
            })
          ),
          ...(data.cities || []).map((c: { title: string }) => ({
            type: 'city' as const,
            title: c.title,
            href: `/buscar?q=${encodeURIComponent(q)}&city=${encodeURIComponent(c.title)}`,
          })),
          ...(data.artists || []).map((a: { name: string; slug: string }) => ({
            type: 'artist' as const,
            title: a.name,
            href: `/events/${a.slug}`,
          })),
        ];
        setItems(next.length ? next : buildStatic(q));
        setActive(-1);
      } catch {
        if (alive) setItems(buildStatic(q));
      }
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, buildStatic]);

  function go(query: string, cityName = city) {
    const trimmed = query.trim();
    if (!trimmed) return;
    saveRecent(trimmed);
    setOpen(false);
    if (onSearch) {
      onSearch(trimmed, cityName);
      return;
    }
    const params = new URLSearchParams({ q: trimmed });
    if (cityName) params.set('city', cityName);
    router.push(`/buscar?${params.toString()}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      if (active >= 0 && items[active]) {
        event.preventDefault();
        const it = items[active];
        if (it.href?.startsWith('/buscar') || it.type === 'recent' || it.type === 'example') {
          go(it.title, city);
        } else if (it.href) {
          saveRecent(it.title);
          router.push(it.href);
        }
      } else {
        go(q);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  function startVoice() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'es-MX';
    rec.continuous = false;
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript ?? '';
      if (text) {
        setQ(text);
        go(text);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  const activeId = active >= 0 ? `${listId}-opt-${active}` : undefined;

  return (
    <form
      className={styles.search}
      role="search"
      data-compact={compact || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className={styles.searchIcon}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Buscar
      </label>
      <div className={styles.combo}>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={shortPlaceholder ? 'Buscar' : '¿Qué quieres ver?'}
          autoComplete="off"
        />
        {open && items.length > 0 ? (
          <ul id={listId} role="listbox" className={styles.list}>
            {items.map((it, i) => (
              <li
                key={`${it.type}-${it.title}-${i}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                data-active={i === active || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (it.href && (it.type === 'event' || it.type === 'venue' || it.type === 'artist')) {
                    saveRecent(it.title);
                    router.push(it.href);
                  } else {
                    go(it.title);
                  }
                }}
              >
                <span className={styles.optTitle}>{it.title}</span>
                {it.subtitle ? <span className={styles.optSub}>{it.subtitle}</span> : null}
                <span className={styles.optType}>
                  {it.type === 'event'
                    ? 'Evento'
                    : it.type === 'venue'
                      ? 'Recinto'
                      : it.type === 'city'
                        ? 'Ciudad'
                        : it.type === 'artist'
                          ? 'Artista'
                          : it.type === 'recent'
                            ? 'Reciente'
                            : 'Ejemplo'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {voice ? (
        <button
          type="button"
          className={styles.mic}
          aria-label={listening ? 'Escuchando…' : 'Buscar por voz'}
          aria-pressed={listening}
          onClick={startVoice}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5 11a7 7 0 0014 0M12 18v4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      ) : null}
      <label className={styles.city}>
        <span className="sr-only">Ciudad</span>
        <select
          name="city"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            if (q.trim()) go(q, e.target.value);
          }}
        >
          <option value="">Todas</option>
          {cities.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Link href="/buscar" className={styles.more} aria-label="Búsqueda avanzada">
        /
      </Link>
    </form>
  );
}
