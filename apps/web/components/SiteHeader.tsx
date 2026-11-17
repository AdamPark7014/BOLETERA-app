'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandLogo } from '@boletera/ui';
import { getStoredUser, type AuthUser } from '@/lib/auth';
import styles from './SiteHeader.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** Navegación por categoría de la maqueta. Palenque no es categoría del API: busca por texto. */
export const NAV_CATEGORIES = [
  { href: '/categoria/MUSIC', label: 'Conciertos' },
  { href: '/?q=palenque', label: 'Palenque' },
  { href: '/categoria/SPORTS', label: 'Deportes' },
  { href: '/categoria/THEATER', label: 'Teatro' },
  { href: '/categoria/FESTIVAL', label: 'Festivales' },
  { href: '/membresias', label: 'Membresías' },
];

type SiteHeaderProps = {
  /** Compacto (pago, fila): sin navegación ni buscador. */
  compact?: boolean;
  /** Compatibilidad con llamadas anteriores; el tema es único. */
  theme?: 'light' | 'dark';
};

function initials(user: AuthUser): string {
  const first = user.firstName?.trim()?.[0] ?? '';
  const last = user.lastName?.trim()?.[0] ?? '';
  return (first + last || user.email?.[0] || '·').toUpperCase();
}

function SearchPill() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [city, setCity] = useState(params.get('city') ?? '');
  const [cities, setCities] = useState<string[]>([]);
  const [shortPlaceholder, setShortPlaceholder] = useState(false);

  useEffect(() => {
    setQ(params.get('q') ?? '');
    setCity(params.get('city') ?? '');
  }, [params]);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/discovery/facets`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { cities?: { name: string }[] } | null) => {
        if (alive && data?.cities) setCities(data.cities.map((c) => c.name));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 479px)');
    const sync = () => setShortPlaceholder(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <form className={styles.search} action="/" method="get" role="search">
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
      <label htmlFor="bt-q" className="sr-only">
        Buscar
      </label>
      <input
        id="bt-q"
        name="q"
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={shortPlaceholder ? 'Buscar' : 'Artista, equipo o recinto'}
        autoComplete="off"
      />
      <label className={styles.city}>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <span className="sr-only">Ciudad</span>
        <select
          name="city"
          value={city}
          onChange={(event) => {
            setCity(event.target.value);
            event.currentTarget.form?.requestSubmit();
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
    </form>
  );
}

/** Encabezado: logo, buscador con ciudad, Mis boletos y cuenta; categorías en fila secundaria. */
export function SiteHeader({ compact = false }: SiteHeaderProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setReady(true);
  }, [pathname]);

  return (
    <>
      <a className={styles.skip} href="#contenido">
        Saltar al contenido
      </a>
      <header className={styles.header} data-compact={compact || undefined}>
        <div className={styles.inner}>
          <Link href="/" className={styles.logo} aria-label="Black Ticket, inicio">
            <BrandLogo size={30} />
          </Link>

          {!compact ? (
            <Suspense fallback={<div className={styles.search} aria-hidden="true" />}>
              <SearchPill />
            </Suspense>
          ) : (
            <span className={styles.spacer} />
          )}

          <div className={styles.actions}>
            <Link href="/cuenta" className={styles.tickets}>
              Mis boletos
            </Link>
            {!ready ? (
              <span className={styles.avatarSlot} aria-hidden="true" />
            ) : user ? (
              <Link
                href="/cuenta"
                className={styles.avatar}
                aria-label={`Cuenta de ${user.firstName || user.email}`}
              >
                {initials(user)}
              </Link>
            ) : (
              <Link href="/login" className={styles.enter}>
                Entrar
              </Link>
            )}
          </div>
        </div>
        {!compact ? (
          <nav className={styles.nav} aria-label="Categorías">
            <div className={styles.navInner}>
              {NAV_CATEGORIES.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}
      </header>
    </>
  );
}
