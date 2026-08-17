'use client';

import Link from 'next/link';
import { memo, useMemo } from 'react';
import { Tooltip } from '@boletera/ui';
import { useVenues } from '@/lib/queries';
import { LogoMark, ShellIcon } from './icons';
import {
  NAV_GROUPS,
  flattenNavItems,
  isNavItemActive,
  type NavItemDef,
} from './nav-config';
import type { ShellPrefs } from './use-shell-prefs';
import { ShellUserMenu } from './ShellUserMenu';
import styles from '@/app/(platform)/shell.module.scss';

type LinkPropsFn = (href: string) => {
  onMouseEnter: () => void;
  onFocus: () => void;
};

type ShellSidebarProps = {
  pathname: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  prefs: ShellPrefs;
  linkProps: LinkPropsFn;
  onOpenCommand: () => void;
  onOpenShortcuts: () => void;
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
          aria-label={favorite ? `Quitar ${item.label} de favoritos` : `Añadir ${item.label} a favoritos`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(item.href)}
        >
          <ShellIcon name={favorite ? 'starFilled' : 'star'} size={14} />
        </button>
      ) : null}
    </div>
  );
}

function ShellSidebarComponent({
  pathname,
  mobileOpen,
  onCloseMobile,
  prefs,
  linkProps,
  onOpenCommand,
  onOpenShortcuts,
}: ShellSidebarProps) {
  const { data: venues = [] } = useVenues();
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
          <Tooltip content={prefs.compact ? 'Expandir barra' : 'Modo compacto'} placement="bottom">
            <button
              type="button"
              className={styles.iconBtnGhost}
              aria-label={prefs.compact ? 'Expandir barra lateral' : 'Compactar barra lateral'}
              aria-pressed={prefs.compact}
              onClick={prefs.toggleCompact}
            >
              <ShellIcon name={prefs.compact ? 'panelLeft' : 'panelLeftClose'} size={16} />
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
          const collapsed = prefs.isGroupCollapsed(group.id);
          return (
            <div key={group.id} className={styles.navGroup}>
              {!prefs.compact ? (
                <button
                  type="button"
                  className={styles.navGroupToggle}
                  aria-expanded={!collapsed}
                  onClick={() => prefs.toggleGroup(group.id)}
                >
                  <span className={styles.navLabel}>{group.label}</span>
                  <ShellIcon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
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
                            <Tooltip key={venue.id} content={venue.name} placement="right">
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
                              className={active ? styles.navSubActive : styles.navSubItem}
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

export const ShellSidebar = memo(ShellSidebarComponent);
