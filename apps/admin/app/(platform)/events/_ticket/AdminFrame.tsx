'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BlackTicketRoot, BrandLogo } from '@boletera/ui';
import { logoutSession } from '@/lib/http';
import { hasAnyCapability, hasCapability, isKnownRole, ROLE_LABELS } from '@/lib/permissions';
import { useSession } from '@/lib/use-session';
import { useConnectionStatus } from '@/components/shell/use-connection-status';
import { ShellIcon } from '@/components/shell/icons';
import {
  activeIndexId,
  activeSectionId,
  canSeeItem,
  eventIdFromPath,
  SECTIONS,
  eventItems,
  sectionsForRole,
  type IndexItem,
} from './catalog';
import { NoAccess } from './NoAccess';
import styles from './frame.module.scss';

type FrameValue = {
  query: string;
  eventId: string | null;
  section: string;
  /** La ficha avisa que el evento no existe: el menú deja de ofrecer «Este evento». */
  markEventMissing?: (eventId: string) => void;
};

const FrameContext = createContext<FrameValue>({ query: '', eventId: null, section: 'lista' });

export function useAdminFrame(): FrameValue {
  return useContext(FrameContext);
}

function initialsOf(display: string | null | undefined): string {
  if (!display) return 'BT';
  const name = display.split('@')[0] ?? '';
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2)) || 'BT';
  return letters.toUpperCase();
}

function roleName(role: string | null): string {
  if (!role) return 'Sin rol';
  return isKnownRole(role) ? ROLE_LABELS[role] : role;
}

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const role = session.role;
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const eventId = eventIdFromPath(pathname);
  const [missingEventId, setMissingEventId] = useState<string | null>(null);
  const sectionParam = search.get('seccion');
  const section = eventId
    ? (sectionParam ?? 'evento')
    : (activeIndexId(pathname, sectionParam) ?? 'lista');
  const active = activeIndexId(pathname, sectionParam);
  const activeSection = activeSectionId(pathname);
  const sections = useMemo(() => sectionsForRole(role), [role]);
  const ev = useMemo(() => {
    if (!eventId || eventId === missingEventId) return null;
    const items = eventItems(eventId);
    return {
      main: items.main.filter((item) => canSeeItem(role, item)),
      more: items.more.filter((item) => canSeeItem(role, item)),
    };
  }, [eventId, role, missingEventId]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [] as (IndexItem & { section: string })[];
    return sections
      .flatMap((group) => group.items.map((item) => ({ ...item, section: group.label })))
      .filter(
        (item) =>
          item.label.toLowerCase().includes(needle) || item.section.toLowerCase().includes(needle)
      )
      .slice(0, 8);
  }, [query, sections]);

  const dayHref = hasAnyCapability(role, ['access.scan', 'safety.view'])
    ? hasCapability(role, 'safety.view')
      ? '/access-control'
      : '/scanner'
    : null;
  const canExport = hasCapability(role, 'reports.view');

  useEffect(() => {
    if (pathname !== '/dashboard' || !role) return;
    if (hasCapability(role, 'dashboard.view')) return;
    const target = sectionsForRole(role)[0]?.items[0]?.href;
    if (target && target !== '/dashboard') router.replace(target);
  }, [pathname, role, router]);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname, sectionParam]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isCtrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (isCtrlK) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setSearchOpen(false);
        return;
      }
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const nodes = document.querySelectorAll<HTMLElement>('[data-param]');
    const hit = [...nodes].find((node) =>
      (node.dataset.param ?? '').toLowerCase().includes(needle)
    );
    hit?.scrollIntoView({ block: 'nearest' });
  }, [query, section]);

  async function salir() {
    await logoutSession();
    router.replace('/login');
  }

  function itemLink(item: IndexItem, sub = false) {
    const current = item.id === active;
    const className = sub
      ? current
        ? styles.subCurrent
        : styles.subLink
      : current
        ? styles.navCurrent
        : styles.navLink;
    return (
      <li key={item.id}>
        <Link href={item.href} className={className} aria-current={current ? 'page' : undefined}>
          {sub ? null : <span className={styles.dot} aria-hidden="true" />}
          {item.label}
        </Link>
      </li>
    );
  }

  const email = session.user?.email ?? null;
  const displayName = session.user?.name || email;
  const firstHref = sections[0]?.items[0]?.href ?? null;
  const activeItem = active
    ? SECTIONS.flatMap((group) => group.items).find((item) => item.id === active)
    : undefined;
  const blocked = Boolean(role && activeItem && !eventId && !canSeeItem(role, activeItem));

  return (
    <BlackTicketRoot density="admin" className={styles.root}>
      <FrameContext.Provider
        value={{ query, eventId, section, markEventMissing: setMissingEventId }}
      >
        <div className={styles.frame}>
          <nav
            id="menu-principal"
            className={menuOpen ? `${styles.index} ${styles.indexOpen}` : styles.index}
            aria-label="Menú principal"
          >
            <div className={styles.brandRow}>
              <Link href="/dashboard" className={styles.brand} aria-label="Black Ticket, inicio">
                <BrandLogo tone="white" size={32} />
              </Link>
              <button
                type="button"
                className={styles.closeMenu}
                aria-label="Cerrar menú"
                onClick={() => setMenuOpen(false)}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>

            {sections.length > 0 ? (
              <>
                <p className={styles.groupLabel}>ORGANIZACIÓN</p>
                <ul className={styles.navList}>
                  {sections.map((group) => {
                    const open = group.id === activeSection;
                    const first = group.items[0]!;
                    return (
                      <li key={group.id}>
                        <Link
                          href={first.href}
                          className={open ? styles.navCurrent : styles.navLink}
                          aria-current={open && !eventId ? 'true' : undefined}
                        >
                          <span className={styles.navIcon} aria-hidden="true">
                            <ShellIcon name={group.icon} size={17} />
                          </span>
                          {group.label}
                        </Link>
                        {open && group.items.length > 1 && !eventId ? (
                          <ul className={styles.subList} aria-label={`Pantallas de ${group.label}`}>
                            {group.items.map((item) => itemLink(item, true))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.quiet}>
                Tu rol no incluye pantallas del panel. Pide acceso a quien administra tu
                organización.
              </p>
            )}

            {ev ? (
              <>
                <p className={styles.groupLabel}>ESTE EVENTO</p>
                <ul className={styles.navList}>
                  {[...ev.main, ...ev.more].map((item) => itemLink(item))}
                </ul>
              </>
            ) : null}

            <div className={styles.userCard}>
              <span className={styles.avatar} aria-hidden="true">
                {initialsOf(displayName)}
              </span>
              <div className={styles.userText}>
                <span className={styles.userName} title={email ?? undefined}>
                  {displayName ?? 'Sesión activa'}
                </span>
                <span className={styles.userRole}>{roleName(role)}</span>
              </div>
              <button type="button" className={styles.logout} onClick={() => void salir()}>
                Salir
              </button>
            </div>
          </nav>

          {menuOpen ? (
            <button
              type="button"
              className={styles.scrim}
              aria-label="Cerrar menú"
              onClick={() => setMenuOpen(false)}
            />
          ) : null}

          <div className={styles.main}>
            <header className={styles.topbar}>
              <button
                type="button"
                className={styles.menuButton}
                aria-label="Abrir menú"
                aria-expanded={menuOpen}
                aria-controls="menu-principal"
                onClick={() => setMenuOpen(true)}
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <Link href="/dashboard" className={styles.topBrand} aria-label="Black Ticket, inicio">
                <BrandLogo tone="white" size={22} />
              </Link>
              <div className={styles.search} role="search">
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4-4" />
                </svg>
                <input
                  ref={searchRef}
                  id="indice-buscar"
                  type="search"
                  className={styles.searchInput}
                  aria-label="Buscar en esta pantalla y en el menú"
                  placeholder="Busca un evento, una pantalla o un dato"
                  value={query}
                  autoComplete="off"
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && matches[0]) {
                      event.preventDefault();
                      router.push(matches[0].href);
                      setQuery('');
                    }
                  }}
                />
                {searchOpen && matches.length > 0 ? (
                  <ul className={styles.searchResults} aria-label="Pantallas que coinciden">
                    {matches.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className={styles.searchHit}
                          onClick={() => setQuery('')}
                        >
                          <span>{item.label}</span>
                          <span className={styles.searchSection}>{item.section}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <LiveStatus />
              {canExport ? (
                <Link href="/reports" className={styles.ghostButton}>
                  Exportar
                </Link>
              ) : null}
              {dayHref ? (
                <Link href={dayHref} className={styles.goldButton}>
                  Modo día del evento
                </Link>
              ) : null}
            </header>
            <div id="contenido-frame" className={styles.canvas}>
              {blocked ? (
                <section>
                  <header className={styles.sectionHead}>
                    <h1 className={styles.sectionTitle}>{activeItem?.label}</h1>
                    <NoAccess href={firstHref ?? '/dashboard'} />
                  </header>
                </section>
              ) : (
                children
              )}
            </div>
          </div>
        </div>
      </FrameContext.Provider>
    </BlackTicketRoot>
  );
}

function LiveStatus() {
  const status = useConnectionStatus();
  if (status.tone !== 'online' && status.tone !== 'offline') return null;
  const live = status.tone === 'online';
  const text = live ? 'En vivo' : 'Sin conexión';
  const tone = live ? styles.liveOk : styles.liveWait;
  return (
    <span className={`${styles.live} ${tone}`} title={status.detail} role="status">
      <span className={styles.liveDot} aria-hidden="true" />
      <span className={styles.liveText}>{text}</span>
    </span>
  );
}
