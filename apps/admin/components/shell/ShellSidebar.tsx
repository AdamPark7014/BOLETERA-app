'use client';

import Link from 'next/link';
import { memo, useEffect, useMemo } from 'react';
import { Tooltip } from '@boletera/ui';
import { useVenues } from '@/lib/queries';
import { LogoMark, ShellIcon } from './icons';
import {
  NAV_GROUPS,
  filterNavGroupsForRole,
  flattenNavItems,
  isNavItemActive,
  type NavItemDef,
} from './nav-config';
import { useSession } from '@/lib/use-session';
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

function navItemClass(active: boolean) {
  return [styles.navItem, active ? styles.navItemActive : ''].filter(Boolean).join(' ');
}

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

  const link = (
    <Link
      href={item.href}
      className={navItemClass(active)}
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

function groupHasActiveRoute(
  pathname: string,
  items: readonly NavItemDef[],
  venues: { id: string }[],
  showVenues?: boolean,
): boolean {
  if (items.some((item) => isNavItemActive(pathname, item))) return true;
  if (!showVenues) return false;
  return venues.some((venue) => pathname.startsWith(`/venues/${venue.id}/`));
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
  const { role } = useSession();
  const { data: venues = [] } = useVenues();
  const visibleGroups = useMemo(
    () => filterNavGroupsForRole(NAV_GROUPS, role),
    [role],
  );
  const itemsByHref = useMemo(() => {
    const map = new Map<string, NavItemDef>();
    for (const item of flattenNavItems(role)) map.set(item.href, item);
    return map;
  }, [role]);

  const favoriteItems = useMemo(() => {
    return prefs.favorites
      .map((href) => itemsByHref.get(href))
      .filter((item): item is NavItemDef => Boolean(item));
  }, [itemsByHref, prefs.favorites]);

  useEffect(() => {
    if (prefs.compact) return;
    const { isGroupCollapsed, toggleGroup } = prefs;
    for (const group of visibleGroups) {
      const hasActive = groupHasActiveRoute(
        pathname,
        group.items,
        venues,
        group.showVenues,
      );
      if (hasActive && isGroupCollapsed(group.id)) {
        toggleGroup(group.id);
      }
    }
  }, [pathname, prefs.compact, prefs.isGroupCollapsed, prefs.toggleGroup, venues, visibleGroups]);

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
          <div className={styles.navGroup} data-group="favorites">
            {!prefs.compact ? (
              <p className={styles.navLabel}>
                <ShellIcon name="starFilled" size={12} />
                Favoritos
              </p>
            ) : null}
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

        {visibleGroups.map((group) => {
          const collapsed = prefs.isGroupCollapsed(group.id);
          const hasActive = groupHasActiveRoute(
            pathname,
            group.items,
            venues,
            group.showVenues,
          );
          const showItems = prefs.compact || !collapsed;

          return (
            <div
              key={group.id}
              className={styles.navGroup}
              data-group={group.id}
              data-has-active={hasActive ? 'true' : undefined}
            >
              {!prefs.compact ? (
                <button
                  type="button"
                  className={styles.navGroupToggle}
                  aria-expanded={!collapsed}
                  data-collapsed={collapsed ? 'true' : 'false'}
                  onClick={() => prefs.toggleGroup(group.id)}
                >
                  <span className={styles.navLabel}>{group.label}</span>
                  <span className={styles.navGroupChevron} aria-hidden="true">
                    <ShellIcon name="chevronDown" size={14} />
                  </span>
                </button>
              ) : null}

              <div
                className={styles.navGroupContent}
                data-collapsed={!prefs.compact && collapsed ? 'true' : 'false'}
                aria-hidden={!showItems}
              >
                <div className={styles.navGroupInner}>
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
                                className={navItemClass(active)}
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
                </div>
              </div>
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
