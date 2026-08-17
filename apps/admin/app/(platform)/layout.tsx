'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Skeleton, Tooltip } from '@boletera/ui';
import {
  LogoMark,
  ShellIcon,
  ThemeProvider,
  type IconName,
} from '@/components/shell';
import {
  ShellCommandPalette,
  type CommandPaletteMode,
} from '@/components/shell/ShellCommandPalette';
import { ShellTopbar } from '@/components/shell/ShellTopbar';
import { ShellUserMenu } from '@/components/shell/ShellUserMenu';
import { useShellPrefs, type ShellPrefs } from '@/components/shell/use-shell-prefs';
import { usePrefetchNavigation } from '@/lib/prefetch';
import { useVenues } from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import styles from './shell.module.scss';

/* -------------------------------------------------------------------------- */
/* Nav catalog                                                                */
/* -------------------------------------------------------------------------- */

type NavMatch = 'exact' | 'prefix' | 'events' | 'reports';

type NavItemDef = {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  match?: NavMatch;
};

type NavGroupDef = {
  id: string;
  label: string;
  items: readonly NavItemDef[];
  showVenues?: boolean;
  defaultCollapsed?: boolean;
};

const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: 'operation',
    label: 'Operación',
    items: [
      { id: 'dashboard', href: '/dashboard', label: 'Inicio', icon: 'home', match: 'exact' },
      { id: 'events', href: '/events', label: 'Eventos', icon: 'events', match: 'events' },
      { id: 'calendar', href: '/calendar', label: 'Calendario', icon: 'calendar' },
      { id: 'series', href: '/events/series', label: 'Series', icon: 'series' },
      { id: 'orders', href: '/orders', label: 'Órdenes', icon: 'orders' },
      { id: 'waitlist', href: '/waitlist', label: 'Lista de espera', icon: 'waitlist' },
    ],
  },
  {
    id: 'venues',
    label: 'Venues y mapas',
    showVenues: true,
    items: [
      { id: 'venues-list', href: '/venues', label: 'Venues', icon: 'building', match: 'exact' },
      { id: 'maps', href: '/maps', label: 'Creador de mapas', icon: 'mapPin' },
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    items: [
      { id: 'channels', href: '/channels', label: 'Canales', icon: 'channels' },
      { id: 'campaigns', href: '/campaigns', label: 'Campañas', icon: 'campaigns' },
      { id: 'pricing', href: '/pricing', label: 'Pricing', icon: 'payments' },
      { id: 'crm', href: '/crm', label: 'CRM', icon: 'partners' },
      { id: 'resale', href: '/resale', label: 'Reventa', icon: 'resale' },
      { id: 'memberships', href: '/memberships', label: 'Membresías', icon: 'season' },
      { id: 'sponsorships', href: '/sponsorships', label: 'Patrocinios', icon: 'campaigns' },
      { id: 'season', href: '/season', label: 'Abonos', icon: 'season' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventario y reservas',
    items: [
      { id: 'inventory', href: '/inventory', label: 'Inventario', icon: 'orders' },
      { id: 'reservations', href: '/reservations', label: 'Reservas', icon: 'calendar' },
    ],
  },
  {
    id: 'access',
    label: 'Accesos y staff',
    items: [
      { id: 'scanner', href: '/scanner', label: 'Escáner', icon: 'scanner' },
      { id: 'access-control', href: '/access-control', label: 'Control de acceso', icon: 'fraud' },
      { id: 'staff', href: '/staff', label: 'Staff', icon: 'team' },
    ],
  },
  {
    id: 'finance',
    label: 'Finanzas',
    items: [
      { id: 'payouts', href: '/payouts', label: 'Liquidaciones', icon: 'payouts' },
      { id: 'billing', href: '/billing/cfdi', label: 'Facturación', icon: 'billing' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Inteligencia',
    items: [
      { id: 'analytics', href: '/analytics', label: 'Analítica', icon: 'analytics' },
      { id: 'ai', href: '/ai', label: 'IA', icon: 'analytics' },
      { id: 'automations', href: '/automations', label: 'Automatizaciones', icon: 'series' },
      { id: 'reports', href: '/reports', label: 'Reportes', icon: 'reports', match: 'reports' },
      { id: 'fraud', href: '/fraud', label: 'Antifraude', icon: 'fraud' },
      { id: 'egress', href: '/reports/egress', label: 'Egress', icon: 'egress' },
    ],
  },
  {
    id: 'platform',
    label: 'Plataforma',
    defaultCollapsed: true,
    items: [
      { id: 'platform-caps', href: '/platform', label: 'Capacidades', icon: 'platform' },
      { id: 'partners', href: '/partners', label: 'Partners', icon: 'partners' },
      { id: 'integrations', href: '/integrations', label: 'Integraciones', icon: 'platform' },
      { id: 'api-management', href: '/api-management', label: 'API', icon: 'external' },
      { id: 'audit', href: '/audit', label: 'Auditoría', icon: 'audit' },
      { id: 'team', href: '/settings/organization', label: 'Equipo', icon: 'team' },
      { id: 'branding', href: '/settings/branding', label: 'Marca', icon: 'branding' },
      { id: 'payments', href: '/settings/payments', label: 'Pagos Banorte', icon: 'payments' },
    ],
  },
];

function flattenNavItems(): NavItemDef[] {
  return NAV_GROUPS.flatMap((group) => [...group.items]);
}

function isNavItemActive(pathname: string, item: NavItemDef): boolean {
  const match = item.match ?? 'prefix';
  if (match === 'exact') return pathname === item.href;
  if (match === 'events') {
    if (pathname === '/events') return true;
    if (!pathname.startsWith('/events/')) return false;
    return !pathname.startsWith('/events/series');
  }
  if (match === 'reports') {
    if (pathname === '/reports') return true;
    if (!pathname.startsWith('/reports/')) return false;
    return !pathname.startsWith('/reports/egress');
  }
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

type LinkPropsFn = (href: string) => {
  onMouseEnter: () => void;
  onFocus: () => void;
};

function NavLink({
  item,
  pathname,
  compact,
  favorite,
  onToggleFavorite,
  onNavigate,
  linkProps,
}: {
  item: NavItemDef;
  pathname: string;
  compact: boolean;
  favorite: boolean;
  onToggleFavorite: (href: string) => void;
  onNavigate: () => void;
  linkProps: LinkPropsFn;
}) {
  const active = isNavItemActive(pathname, item);
  const className = active ? styles.active : styles.navItem;

  const link = (
    <Link
      href={item.href}
      className={className}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      title={compact ? item.label : undefined}
      {...linkProps(item.href)}
    >
      <span className={styles.navIcon}>
        <ShellIcon name={item.icon} size={18} />
      </span>
      {!compact ? <span className={styles.navText}>{item.label}</span> : null}
    </Link>
  );

  return (
    <div className={styles.navItemRow}>
      {compact ? (
        <Tooltip content={item.label} placement="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
      {!compact ? (
        <button
          type="button"
          className={`${styles.favBtn} ${favorite ? styles.favBtnActive : ''}`}
          aria-label={
            favorite
              ? `Quitar ${item.label} de favoritos`
              : `Añadir ${item.label} a favoritos`
          }
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(item.href)}
        >
          <ShellIcon name={favorite ? 'starFilled' : 'star'} size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AdminSidebar({
  pathname,
  mobileOpen,
  onCloseMobile,
  prefs,
  linkProps,
  onOpenCommand,
  onOpenShortcuts,
}: {
  pathname: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  prefs: ShellPrefs;
  linkProps: LinkPropsFn;
  onOpenCommand: () => void;
  onOpenShortcuts: () => void;
}) {
  const { data: venues = [] } = useVenues();
  const [localCollapsed, setLocalCollapsed] = useState<ReadonlySet<string>>(() => {
    return new Set(
      NAV_GROUPS.filter((g) => g.defaultCollapsed).map((g) => g.id),
    );
  });

  const itemsByHref = useMemo(() => {
    const map = new Map<string, NavItemDef>();
    for (const item of flattenNavItems()) map.set(item.href, item);
    return map;
  }, []);

  const favoriteItems = useMemo(() => {
    return prefs.favorites
      .map((href) => itemsByHref.get(href))
      .filter((item): item is NavItemDef => Boolean(item));
  }, [itemsByHref, prefs.favorites]);

  const isGroupClosed = useCallback(
    (groupId: string) => localCollapsed.has(groupId),
    [localCollapsed],
  );

  const toggleGroup = useCallback((groupId: string) => {
    setLocalCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const sidebarClass = [
    styles.sidebar,
    prefs.compact ? styles.sidebarCompact : '',
    mobileOpen ? styles.sidebarOpen : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside
      className={sidebarClass}
      aria-label="Navegación principal"
      data-compact={prefs.compact ? 'true' : 'false'}
    >
      <div className={styles.sidebarTop}>
        <Link
          href="/dashboard"
          className={styles.logoBlock}
          onClick={onCloseMobile}
          {...linkProps('/dashboard')}
        >
          <div className={styles.logoMark}>
            <LogoMark />
          </div>
          {!prefs.compact ? (
            <div>
              <p className={styles.logoText}>TicketOS</p>
              <p className={styles.logoSub}>Administración</p>
            </div>
          ) : null}
        </Link>
        <div className={styles.sidebarTopActions}>
          <Tooltip
            content={prefs.compact ? 'Expandir barra' : 'Modo compacto'}
            placement="bottom"
          >
            <button
              type="button"
              className={styles.iconBtnGhost}
              aria-label={
                prefs.compact ? 'Expandir barra lateral' : 'Compactar barra lateral'
              }
              aria-pressed={prefs.compact}
              onClick={prefs.toggleCompact}
            >
              <ShellIcon
                name={prefs.compact ? 'panelLeft' : 'panelLeftClose'}
                size={16}
              />
            </button>
          </Tooltip>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCloseMobile}
            aria-label="Cerrar menú"
          >
            <ShellIcon name="close" size={16} />
          </button>
        </div>
      </div>

      <button
        type="button"
        className={styles.searchTrigger}
        onClick={onOpenCommand}
        aria-label="Abrir buscador de comandos"
      >
        <ShellIcon name="search" size={16} />
        {!prefs.compact ? (
          <>
            <span>Buscar…</span>
            <kbd className={styles.kbd}>⌘K</kbd>
          </>
        ) : null}
      </button>

      <nav className={styles.nav} aria-label="Módulos">
        {favoriteItems.length > 0 ? (
          <div className={styles.navGroup}>
            {!prefs.compact ? <p className={styles.navLabel}>Favoritos</p> : null}
            {favoriteItems.map((item) => (
              <NavLink
                key={`fav-${item.href}`}
                item={item}
                pathname={pathname}
                compact={prefs.compact}
                favorite
                onToggleFavorite={prefs.toggleFavorite}
                onNavigate={onCloseMobile}
                linkProps={linkProps}
              />
            ))}
          </div>
        ) : null}

        {NAV_GROUPS.map((group) => {
          const collapsed = isGroupClosed(group.id);

          return (
            <div key={group.id} className={styles.navGroup} data-group={group.id}>
              {!prefs.compact ? (
                <button
                  type="button"
                  className={styles.navGroupToggle}
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className={styles.navLabel}>{group.label}</span>
                  <ShellIcon
                    name={collapsed ? 'chevronRight' : 'chevronDown'}
                    size={14}
                  />
                </button>
              ) : null}

              {!collapsed || prefs.compact ? (
                <>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      pathname={pathname}
                      compact={prefs.compact}
                      favorite={prefs.isFavorite(item.href)}
                      onToggleFavorite={prefs.toggleFavorite}
                      onNavigate={onCloseMobile}
                      linkProps={linkProps}
                    />
                  ))}

                  {group.showVenues
                    ? venues.map((venue) => {
                        const base = `/venues/${venue.id}`;
                        const active = pathname.startsWith(`${base}/`);
                        if (prefs.compact) {
                          return (
                            <Tooltip
                              key={venue.id}
                              content={venue.name}
                              placement="right"
                            >
                              <Link
                                href={`${base}/3d?studio=1`}
                                className={active ? styles.active : styles.navItem}
                                onClick={onCloseMobile}
                                aria-label={`${venue.name} — Estudio 3D`}
                                {...linkProps(`${base}/3d?studio=1`)}
                              >
                                <span className={styles.navIcon}>
                                  <ShellIcon name="mapPin" size={18} />
                                </span>
                              </Link>
                            </Tooltip>
                          );
                        }
                        return (
                          <div key={venue.id} className={styles.navSubRow}>
                            <Link
                              href={`${base}/3d?studio=1`}
                              className={
                                active ? styles.navSubActive : styles.navSubItem
                              }
                              onClick={onCloseMobile}
                              title={`Estudio 3D — ${venue.name}`}
                              {...linkProps(`${base}/3d?studio=1`)}
                            >
                              {venue.name}
                            </Link>
                            <Link
                              href={`${base}/3d?studio=1`}
                              className={
                                pathname.startsWith(`${base}/3d`)
                                  ? styles.navSubTagActive
                                  : styles.navSubTag
                              }
                              onClick={onCloseMobile}
                              title={`Estudio 3D — ${venue.name}`}
                              {...linkProps(`${base}/3d?studio=1`)}
                            >
                              3D
                            </Link>
                            <Link
                              href={`${base}/map`}
                              className={
                                pathname === `${base}/map`
                                  ? styles.navSubTagActive
                                  : styles.navSubTag
                              }
                              onClick={onCloseMobile}
                              title={`Vista planta — ${venue.name}`}
                              {...linkProps(`${base}/map`)}
                            >
                              Planta
                            </Link>
                          </div>
                        );
                      })
                    : null}
                </>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <ShellUserMenu linkProps={linkProps} onOpenShortcuts={onOpenShortcuts} />
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

function SkipLink() {
  return (
    <a href="#contenido-principal" className={styles.skipLink}>
      Saltar al contenido
    </a>
  );
}

function ShellLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-live="polite">
      <div className={styles.loadingSidebar} aria-hidden="true">
        <Skeleton shape="rect" height={40} width="80%" />
        <Skeleton shape="rect" height={32} width="100%" delay={40} />
        <Skeleton shape="rect" height={32} width="90%" delay={80} />
        <Skeleton shape="rect" height={32} width="95%" delay={120} />
      </div>
      <div className={styles.content}>
        <div className={styles.loadingTopbar}>
          <Skeleton shape="text" width={180} height={16} />
        </div>
        <main className={styles.main}>
          <Skeleton shape="text" width="40%" height={28} />
          <Skeleton shape="rect" height={160} delay={60} />
        </main>
      </div>
    </div>
  );
}

function PlatformShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const { linkProps } = usePrefetchNavigation();
  const prefs = useShellPrefs();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>('all');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCompact = prefs.toggleCompact;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
          return;
        }
        event.preventDefault();
        toggleCompact();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleCompact]);

  const openCommand = useCallback(() => {
    setCommandMode('all');
    setCommandOpen(true);
  }, []);

  const openShortcuts = useCallback(() => {
    setCommandMode('shortcuts');
    setCommandOpen(true);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  if (status === 'loading') {
    return <ShellLoading />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <div className={styles.shell}>
      <SkipLink />
      <AdminSidebar
        pathname={pathname}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
        prefs={prefs}
        linkProps={linkProps}
        onOpenCommand={openCommand}
        onOpenShortcuts={openShortcuts}
      />

      <div className={styles.content}>
        <ShellTopbar
          pathname={pathname}
          onOpenMobile={openMobile}
          onOpenCommand={openCommand}
          linkProps={linkProps}
        />
        <main id="contenido-principal" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Cerrar menú"
          onClick={closeMobile}
        />
      ) : null}

      <ShellCommandPalette
        open={commandOpen}
        onOpenChange={(open) => {
          setCommandOpen(open);
          if (!open) setCommandMode('all');
        }}
        mode={commandMode}
        onToggleCompact={prefs.toggleCompact}
      />
    </div>
  );
}

const PlatformShell = memo(function PlatformShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ThemeProvider>
      <PlatformShellInner>{children}</PlatformShellInner>
    </ThemeProvider>
  );
});

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
