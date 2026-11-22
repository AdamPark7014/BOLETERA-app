'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useState } from 'react';
import { BrandLogo } from '@boletera/ui';
import { getStoredUser, type AuthUser } from '@/lib/auth';
import styles from './SiteHeader.module.scss';
import { SearchBox } from '@/components/search/SearchBox';

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
  const [cities, setCities] = useState<string[]>([]);

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

  return (
    <SearchBox
      initialQuery={params.get('q') ?? ''}
      initialCity={params.get('city') ?? ''}
      cities={cities}
    />
  );
}

/** Encabezado: logo, buscador con ciudad, Mis boletos y cuenta; menú móvil a pantalla completa. */
export function SiteHeader({ compact = false }: SiteHeaderProps) {
  const pathname = usePathname();
  const menuId = useId();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setReady(true);
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
            {!compact ? (
              <button
                type="button"
                className={styles.menuToggle}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
              </button>
            ) : null}
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

      {menuOpen && !compact ? (
        <div
          id={menuId}
          className={styles.menuOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
        >
          <div className={styles.menuTop}>
            <BrandLogo size={28} />
            <button type="button" className={styles.menuClose} onClick={() => setMenuOpen(false)}>
              Cerrar
            </button>
          </div>
          <nav className={styles.menuNav} aria-label="Menú principal">
            {NAV_CATEGORIES.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/cuenta" onClick={() => setMenuOpen(false)}>
              Mis boletos
            </Link>
            <Link href="/resale" onClick={() => setMenuOpen(false)}>
              Reventa oficial
            </Link>
            <Link href="/ciudades" onClick={() => setMenuOpen(false)}>
              Ciudades
            </Link>
            <Link href="/ayuda" onClick={() => setMenuOpen(false)}>
              Ayuda
            </Link>
            {user ? (
              <Link href="/cuenta" onClick={() => setMenuOpen(false)}>
                Mi cuenta
              </Link>
            ) : (
              <Link href="/login" className={styles.menuPrimary} onClick={() => setMenuOpen(false)}>
                Entrar
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </>
  );
}
