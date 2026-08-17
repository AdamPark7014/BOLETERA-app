'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SessionProvider, useSession } from '@/components/Session/SessionProvider';
import {
  CAPABILITY_LABELS,
  ROLE_LABELS,
  rolesWithCapability,
  type Capability,
} from '@/lib/permissions';
import styles from './shell.module.scss';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  /** Capacidad requerida: si el rol no la tiene, el enlace no se pinta. */
  cap: Capability;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const navGroups: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      {
        href: '/dashboard',
        cap: 'dashboard.view',
        label: 'Inicio',
        icon: <Icon d="M3 12 12 3l9 9M5 10v10h14V10" />,
      },
      {
        href: '/events',
        cap: 'events.view',
        label: 'Eventos',
        icon: <Icon d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6" />,
      },
      {
        href: '/calendar',
        cap: 'events.view',
        label: 'Calendario',
        icon: <Icon d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
      },
      {
        href: '/orders',
        cap: 'orders.view',
        label: 'Órdenes',
        icon: <Icon d="M6 4h12l2 6-7 10-7-10z M3 10h18" />,
      },
    ],
  },
  {
    label: 'Ventas',
    items: [
      {
        href: '/channels',
        cap: 'marketing.manage',
        label: 'Canales',
        icon: <Icon d="M4 12h4l3-7 4 14 3-7h2" />,
      },
      {
        href: '/campaigns',
        cap: 'marketing.manage',
        label: 'Campañas',
        icon: <Icon d="M3 11l18-7-7 18-2-7-9-4z" />,
      },
      {
        href: '/venues',
        cap: 'venues.view',
        label: 'Venues',
        icon: <Icon d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
      },
      {
        href: '/resale',
        cap: 'marketing.manage',
        label: 'Reventa',
        icon: <Icon d="M7 7h13l-1.5 9H7zM7 7L6 4H3 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
      },
    ],
  },
  {
    label: 'Reportes',
    items: [
      {
        href: '/analytics',
        cap: 'analytics.view',
        label: 'Analítica',
        icon: <Icon d="M3 21V3 M3 21h18 M7 17v-5 M11 17v-9 M15 17v-3 M19 17v-7" />,
      },
      {
        href: '/reports',
        cap: 'reports.view',
        label: 'Reportes',
        icon: <Icon d="M6 3h9l5 5v13H6zM14 3v6h6" />,
      },
      {
        href: '/reports/egress',
        cap: 'safety.view',
        label: 'Egress',
        icon: <Icon d="M4 12h10 M14 12l-3-3 M14 12l-3 3 M18 5v14" />,
      },
      {
        href: '/payouts',
        cap: 'finance.view',
        label: 'Liquidaciones',
        icon: <Icon d="M2 8h20v10H2z M6 12h2 M14 12h4" />,
      },
      {
        href: '/fraud',
        cap: 'risk.view',
        label: 'Antifraude',
        icon: <Icon d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4z M9 12l2 2 4-4" />,
      },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      {
        href: '/scanner',
        cap: 'access.scan',
        label: 'Escáner',
        icon: <Icon d="M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M3 12h18" />,
      },
      {
        href: '/settings/branding',
        cap: 'settings.branding',
        label: 'Marca',
        icon: <Icon d="M12 3a9 9 0 1 0 9 9c0-1-3 0-5-2s-1-5-2-6-1-1-2-1z M7 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M10 17a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
      },
      {
        href: '/settings/payments',
        cap: 'settings.payments',
        label: 'Pagos Banorte',
        icon: <Icon d="M2 7h20v10H2z M6 12h4 M14 12h4" />,
      },
    ],
  },
  {
    label: 'Organización',
    items: [
      {
        href: '/platform',
        cap: 'org.manage',
        label: 'Capacidades',
        icon: <Icon d="M4 6h16v12H4z M8 10h8 M8 14h5 M12 2v4 M12 18v4" />,
      },
      {
        href: '/waitlist',
        cap: 'marketing.manage',
        label: 'Lista de espera',
        icon: <Icon d="M4 6h16v12H4z M8 10h8 M8 14h5 M12 2v4" />,
      },
      {
        href: '/partners',
        cap: 'org.manage',
        label: 'Partners',
        icon: <Icon d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4z M9 12h6 M12 9v6" />,
      },
      {
        href: '/billing/cfdi',
        cap: 'finance.view',
        label: 'Facturación',
        icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h6" />,
      },
      {
        href: '/season',
        cap: 'events.manage',
        label: 'Abonos',
        icon: <Icon d="M4 4h16v4H4z M4 10h10v10H4z M16 10h4v10h-4z" />,
      },
      {
        href: '/settings/organization',
        cap: 'org.manage',
        label: 'Equipo',
        icon: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" />,
      },
      {
        href: '/audit',
        cap: 'audit.view',
        label: 'Auditoría',
        icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" />,
      },
    ],
  },
];

const allNavItems = navGroups.flatMap((g) => g.items);

/**
 * Rutas que no aparecen en el menú pero sí exigen permiso. Ocultar el enlace no
 * basta: se llega por marcador, por enlace pegado en un chat o por el botón
 * "Crear evento" de otra pantalla. Sin esta tabla, esas rutas se montaban y el
 * usuario descubría su falta de permiso a base de 403 en cada petición.
 */
const EXTRA_ROUTE_CAPS: [prefix: string, cap: Capability][] = [
  ['/events/new', 'events.manage'],
  ['/venues/', 'venues.view'],
  ['/season', 'events.manage'],
  ['/settings/organization', 'org.manage'],
  ['/billing', 'finance.view'],
];

/** Capacidad exigida por una ruta: gana el prefijo más específico. */
function capabilityForPath(pathname: string): Capability | null {
  const candidates: [string, Capability][] = [
    ...allNavItems.map((i) => [i.href, i.cap] as [string, Capability]),
    ...EXTRA_ROUTE_CAPS,
  ];
  let best: [string, Capability] | null = null;
  for (const [prefix, cap] of candidates) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best[0].length)) best = [prefix, cap];
  }
  return best?.[1] ?? null;
}

/** Enlace del menú que corresponde a la ruta actual (incluye subrutas). */
function activeHrefFor(pathname: string): string | null {
  let best: string | null = null;
  for (const item of allNavItems) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PlatformShell>{children}</PlatformShell>
    </SessionProvider>
  );
}

function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const {
    email: userEmail,
    role,
    can,
    capabilities,
    organizationId,
    logout,
    loading,
    secondsLeft,
    requireReauth,
  } = useSession();

  /** Solo se pintan los grupos con al menos un enlace permitido. */
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => can(i.cap)) }))
        .filter((g) => g.items.length > 0),
    [can],
  );

  /**
   * Lo que el rol NO alcanza. Un menú corto sin explicación se lee como un fallo
   * de la aplicación; enumerarlo convierte la ausencia en información.
   */
  const hiddenSections = useMemo(
    () => allNavItems.filter((i) => !can(i.cap)).map((i) => i.label),
    [can],
  );

  const activeHref = activeHrefFor(pathname);
  const requiredCap = capabilityForPath(pathname);
  const breadcrumb = pathname.split('/').filter(Boolean);

  // Un usuario sin ninguna capacidad (p. ej. CUSTOMER tras el SSO sin invitación)
  // no debe ver el armazón del backoffice: vería un menú vacío y 403 en todo.
  if (!loading && capabilities.length === 0) {
    return (
      <div className={styles.shell}>
        <main className={styles.main} id="main-content">
          <div className={styles.emptyState}>
            <h1 className={styles.emptyTitle}>Tu cuenta aún no tiene acceso</h1>
            <p className={styles.emptyBody}>
              Entraste correctamente, pero tu usuario no tiene un rol asignado en ninguna
              organización. Pide a un administrador que te envíe una invitación desde Equipo &rarr;
              Invitaciones y vuelve a entrar.
            </p>
            <button type="button" onClick={logout} className={styles.emptyBtn}>
              Cerrar sesión
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="skipLink">
        Saltar al contenido
      </a>

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} id="platform-nav">
        <div className={styles.sidebarTop}>
          <div className={styles.logoBlock}>
            <div className={styles.logoMark}>
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect width="32" height="32" rx="9" fill="#fafafa" />
                <path d="M9 11h14M9 16h14M9 21h9" stroke="#0a0a0a" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="22" cy="21" r="2.5" fill="#0a0a0a" />
              </svg>
            </div>
            <div>
              <p className={styles.logoText}>BOLETERA</p>
              <p className={styles.logoSub}>Administración</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* La organización activa manda en cada petición: si no se ve, un 403 del
            OrgAccessGuard es indistinguible de un fallo del servidor. */}
        <div className={styles.orgBlock}>
          <p className={styles.orgLabel}>Organización activa</p>
          {organizationId ? (
            <p className={styles.orgValue} title={organizationId}>
              <code>{organizationId}</code>
            </p>
          ) : (
            <p className={styles.orgMissing}>
              Sin organización — el API rechaza estas pantallas
            </p>
          )}
        </div>

        <nav className={styles.nav} aria-label="Secciones del backoffice">
          {visibleGroups.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <p className={styles.navLabel} id={`nav-${group.label}`}>
                {group.label}
              </p>
              <ul className={styles.navList} aria-labelledby={`nav-${group.label}`}>
                {group.items.map((item) => {
                  const isActive = activeHref === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={isActive ? styles.active : styles.navItem}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span className={styles.navIcon}>{item.icon}</span>
                        <span className={styles.navText}>{item.label}</span>
                        {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {hiddenSections.length > 0 && (
            <details className={styles.hiddenNote}>
              <summary>
                {hiddenSections.length} secciones no están en tu rol
              </summary>
              <p>
                Tu rol es <strong>{role ? ROLE_LABELS[role] : 'sin rol'}</strong>. No se muestran
                porque el API las rechazaría: {hiddenSections.join(', ')}.
              </p>
            </details>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.profile}>
            <div className={styles.avatar} aria-hidden="true">
              {userEmail ? userEmail.charAt(0).toUpperCase() : 'A'}
            </div>
            <div className={styles.profileMeta}>
              <strong>{userEmail || 'Admin'}</strong>
              <span>{role ? ROLE_LABELS[role] : 'Sin rol'}</span>
            </div>
            <button
              type="button"
              className={styles.logoutBtn}
              aria-label="Cerrar sesión"
              onClick={logout}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.topLeft}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setOpen(true)}
              aria-label="Abrir menú"
              aria-expanded={open}
              aria-controls="platform-nav"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <nav className={styles.crumbs} aria-label="Ruta">
              <Link href="/dashboard">Admin</Link>
              {breadcrumb.map((c, i) => (
                <span key={c + i}>
                  <span className={styles.crumbSep} aria-hidden="true">
                    /
                  </span>
                  <span
                    className={i === breadcrumb.length - 1 ? styles.crumbCurrent : ''}
                    aria-current={i === breadcrumb.length - 1 ? 'page' : undefined}
                  >
                    {c.replaceAll('-', ' ')}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <div className={styles.topRight}>
            <SessionStatus secondsLeft={secondsLeft} onRenew={() => void requireReauth()} />
          </div>
        </header>

        <main className={styles.main} id="main-content" tabIndex={-1}>
          {loading || !requiredCap || can(requiredCap) ? (
            children
          ) : (
            <MissingCapability
              cap={requiredCap}
              roleLabel={role ? ROLE_LABELS[role] : 'sin rol'}
              fallback={visibleGroups[0]?.items[0]}
            />
          )}
        </main>
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Estado real de la sesión. Antes había una píldora "En línea" fija y un badge
 * de 3 notificaciones inventado: adorno que además mentía. Lo que de verdad
 * importa saber de un vistazo es cuánto le queda al token.
 */
function SessionStatus({
  secondsLeft,
  onRenew,
}: {
  secondsLeft: number | null;
  onRenew: () => void;
}) {
  if (secondsLeft === null) return null;
  const minutes = Math.floor(secondsLeft / 60);
  const low = minutes <= 10;
  const text =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
      : minutes >= 1
        ? `${minutes} min`
        : 'menos de 1 min';

  return (
    <button
      type="button"
      className={`${styles.statusPill} ${low ? styles.statusPillLow : ''}`}
      onClick={onRenew}
      title="Renovar la sesión sin salir de esta pantalla"
    >
      {/* El punto es decorativo: el estado también va en el texto. */}
      <span className={styles.pillDot} aria-hidden="true" />
      Sesión: {text}
    </button>
  );
}

/**
 * Sustituye a la pantalla cuando el rol no la alcanza. Explica qué falta y a
 * quién pedírselo, en vez de dejar que la pantalla se monte y coleccione 403.
 */
function MissingCapability({
  cap,
  roleLabel,
  fallback,
}: {
  cap: Capability;
  roleLabel: string;
  /** Primera sección que sí alcanza el rol; evita mandarlo a otro muro. */
  fallback?: NavItem;
}) {
  const allowed = rolesWithCapability(cap).map((r) => ROLE_LABELS[r]);
  return (
    <div className={styles.deniedWrap}>
      <p className={styles.deniedEyebrow}>Acceso restringido</p>
      <h1 className={styles.deniedTitle}>Esta sección no está en tu rol</h1>
      <p className={styles.deniedBody}>
        Necesita el permiso <strong>{CAPABILITY_LABELS[cap]}</strong> y tu rol actual es{' '}
        <strong>{roleLabel}</strong>. No es un error: el API rechazaría igualmente cada petición de
        esta pantalla.
      </p>
      <p className={styles.deniedBody}>
        Lo tienen los roles: {allowed.join(', ')}. Si necesitas entrar, pide a un administrador de
        tu organización que cambie tu rol desde Equipo.
      </p>
      {fallback && (
        <Link href={fallback.href} className={styles.deniedBtn}>
          Ir a {fallback.label}
        </Link>
      )}
    </div>
  );
}
