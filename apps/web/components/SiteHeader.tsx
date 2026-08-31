'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearSession, getStoredUser, getToken } from '@/lib/auth';
import { clientTenantHostHeaders } from '@/lib/api';
import { useTenantBrand } from '@/components/TenantBrand';
import styles from './SiteHeader.module.scss';

type SiteHeaderProps = {
  theme?: 'light' | 'dark';
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const navItems = [
  { href: '/categoria/MUSIC', label: 'Conciertos', category: 'MUSIC' },
  { href: '/categoria/SPORTS', label: 'Deportes', category: 'SPORTS' },
  { href: '/categoria/THEATER', label: 'Artes', category: 'THEATER' },
  { href: '/categoria/COMEDY', label: 'Comedia', category: 'COMEDY' },
  { href: '/categoria/FESTIVAL', label: 'Festivales', category: 'FESTIVAL' },
  { href: '/ciudades', label: 'Ciudades' },
  { href: '/venues', label: 'Recintos' },
  { href: '/resale', label: 'Reventa' },
];

type SuggestHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  subtitle?: string;
};

/**
 * El JWT ahora vive 2 h y se revoca al cambiar el usuario, así que la sesión
 * caducada dejó de ser un caso raro. Leemos el `exp` del propio token en vez de
 * pedir permiso al servidor: es gratis, funciona sin red y evita que la barra
 * anuncie "Mi cuenta" cuando el token ya no sirve para nada.
 */
function isTokenUsable(token: string | null): boolean {
  if (!token) return false;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    if (typeof json.exp !== 'number') return true; // sin caducidad declarada
    return json.exp * 1000 > Date.now();
  } catch {
    return false; // token ilegible = sesión inservible
  }
}

export function SiteHeader(props: SiteHeaderProps) {
  return (
    <Suspense fallback={<SiteHeaderBar {...props} activeCategory={null} />}>
      <SiteHeaderWithParams {...props} />
    </Suspense>
  );
}

function SiteHeaderWithParams(props: SiteHeaderProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const fromPath = pathname.startsWith('/categoria/')
    ? pathname.split('/')[2] ?? null
    : null;
  return (
    <SiteHeaderBar
      {...props}
      activeCategory={searchParams.get('category') || fromPath}
    />
  );
}

function SiteHeaderBar({
  theme = 'light',
  activeCategory,
}: SiteHeaderProps & { activeCategory: string | null }) {
  const brand = useTenantBrand();
  const pathname = usePathname();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getToken();
    if (token && !isTokenUsable(token)) {
      // Limpiamos el token muerto para que ninguna página lo mande al API.
      clearSession();
      setLoggedIn(false);
      setName('');
      setSessionExpired(true);
      return;
    }
    const user = getStoredUser();
    setLoggedIn(!!token);
    setName(user ? `${user.firstName}` : '');
    setSessionExpired(false);
  }, [pathname]);

  /*
   * El enlace "saltar al contenido" apunta a #contenido. Las páginas propias ya
   * traen el id, pero el resto del sitio (checkout, carrito, órdenes) también
   * monta esta barra: le ponemos el ancla a su <main> al hidratar para que el
   * salto nunca quede muerto.
   */
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    if (!main.id) main.id = 'contenido';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

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
          { cache: 'no-store', headers: clientTenantHostHeaders() },
        );
        if (!res.ok) return;
        const data = (await res.json()) as SuggestHit[];
        setSuggestions(data);
        setSuggestOpen(data.length > 0);
        setActiveSuggest(-1);
      } catch {
        /* la búsqueda es auxiliar: si falla, el formulario sigue enviando */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function pickSuggest(hit: SuggestHit) {
    setSuggestOpen(false);
    setQuery('');
    setOpen(false);
    router.push(`/events/${hit.slug}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    setSuggestOpen(false);
    setOpen(false);
    if (!q) {
      router.push('/');
      return;
    }
    if (activeSuggest >= 0 && suggestions[activeSuggest]) {
      pickSuggest(suggestions[activeSuggest]);
      return;
    }
    router.push(`/?q=${encodeURIComponent(q)}`);
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

  const effectiveTheme = theme === 'dark' && !scrolled ? 'dark' : 'light';
  // Volver a entrar sin perder el contexto: el login regresa a donde estabas.
  const loginHref =
    pathname && pathname !== '/' && pathname !== '/login'
      ? `/login?next=${encodeURIComponent(pathname)}`
      : '/login';

  return (
    <>
      {open && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Cerrar menú"
          onClick={() => setOpen(false)}
        />
      )}
    <header
      className={`${styles.header} ${effectiveTheme === 'dark' ? styles.dark : ''} ${
        scrolled ? styles.scrolled : ''
      } ${theme === 'dark' && !scrolled ? styles.overHero : ''} ${
        theme === 'dark' && scrolled ? styles.heroHandoff : ''
      }`}
    >
      <a href="#contenido" className={styles.skipLink}>
        Saltar al contenido
      </a>

      {sessionExpired && (
        <p className={styles.sessionNotice} role="status">
          Tu sesión caducó por seguridad.{' '}
          <Link href={loginHref}>Vuelve a entrar</Link> para seguir donde ibas.
        </p>
      )}

      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo}>
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant CMS URL may be data: or arbitrary host
              <img src={brand.logoUrl} alt="" width={32} height={32} />
            ) : (
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
                <rect width="32" height="32" rx="9" fill="currentColor" />
                <path
                  d="M9 11h14M9 16h14M9 21h9"
                  stroke={effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa'}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle
                  cx="22"
                  cy="21"
                  r="2.5"
                  fill={effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa'}
                />
              </svg>
            )}
          </span>
          <span className={styles.brandLockup}>
            <span className={styles.brandText}>{brand.name}</span>
            <span className={styles.brandTag}>Boletos oficiales</span>
          </span>
          <span className="sr-only">— ir al inicio</span>
        </Link>

        <div className={styles.search} ref={searchRef}>
          <form onSubmit={onSubmit} role="search">
            <div className={styles.searchLabel}>
              <label htmlFor="header-search" className="sr-only">
                Buscar eventos
              </label>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              <input
                id="header-search"
                type="search"
                placeholder="Buscar eventos"
                value={query}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestOpen}
                aria-controls="header-suggest"
                aria-activedescendant={
                  activeSuggest >= 0 ? `header-suggest-${activeSuggest}` : undefined
                }
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
                onKeyDown={onSearchKeyDown}
              />
            </div>
          </form>
          {suggestOpen && suggestions.length > 0 && (
            <ul id="header-suggest" className={styles.suggest} role="listbox" aria-label="Sugerencias">
              {suggestions.map((s, i) => (
                <li
                  key={s.id}
                  id={`header-suggest-${i}`}
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

        <nav
          id="site-nav"
          className={`${styles.nav} ${open ? styles.navOpen : ''}`}
          aria-label="Categorías y secciones"
        >
          {navItems.map((item) => {
            const active = item.category
              ? activeCategory === item.category || pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? styles.navActive : styles.navLink}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.actions}>
          <Link href="/cart" className={styles.iconLink}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 4h12l2 6-7 10-7-10z M3 10h18"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">Carrito</span>
          </Link>
          {loggedIn ? (
            <Link href="/cuenta" className={styles.userLink}>
              <span className={styles.avatar} aria-hidden="true">
                {(name || 'M').charAt(0).toUpperCase()}
              </span>
              <span className={styles.userText}>{name || 'Cuenta'}</span>
              <span className="sr-only">Mi cuenta</span>
            </Link>
          ) : (
            <Link href={loginHref} className={styles.cta}>
              Entrar
            </Link>
          )}
          <button
            type="button"
            className={styles.menuBtn}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-nav"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
    </>
  );
}
