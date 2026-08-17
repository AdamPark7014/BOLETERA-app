'use client';

import { memo, useMemo } from 'react';
import { Tooltip } from '@boletera/ui';
import { useVenues } from '@/lib/queries';
import { ShellIcon } from './icons';
import { buildBreadcrumbs } from './routes';
import { ShellBreadcrumbs } from './ShellBreadcrumbs';
import { ShellConnectionPill } from './ShellConnectionPill';
import { ShellNotifications } from './ShellNotifications';
import { ShellThemeToggle } from './ShellThemeToggle';
import styles from '@/app/(platform)/shell.module.scss';

type LinkPropsFn = (href: string) => {
  onMouseEnter: () => void;
  onFocus: () => void;
};

type ShellTopbarProps = {
  pathname: string;
  onOpenMobile: () => void;
  onOpenCommand: () => void;
  linkProps: LinkPropsFn;
};

function ShellTopbarComponent({
  pathname,
  onOpenMobile,
  onOpenCommand,
  linkProps,
}: ShellTopbarProps) {
  const { data: venues = [] } = useVenues();
  const venueNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const venue of venues) map.set(venue.id, venue.name);
    return map;
  }, [venues]);

  const crumbs = useMemo(
    () => buildBreadcrumbs(pathname, venueNames),
    [pathname, venueNames],
  );

  return (
    <header className={styles.topbar}>
      <div className={styles.topLeft}>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={onOpenMobile}
          aria-label="Abrir menú de navegación"
        >
          <ShellIcon name="menu" size={20} />
        </button>
        <ShellBreadcrumbs crumbs={crumbs} linkProps={linkProps} />
      </div>

      <div className={styles.topRight}>
        <button
          type="button"
          className={styles.commandBtn}
          onClick={onOpenCommand}
          aria-label="Abrir buscador de comandos"
        >
          <ShellIcon name="search" size={16} />
          <span>Buscar</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>

        <ShellConnectionPill />
        <ShellThemeToggle />
        <ShellNotifications linkProps={linkProps} />

        <Tooltip content="Centro de ayuda y atajos (⌘K)" placement="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Ayuda y atajos"
            onClick={onOpenCommand}
          >
            <ShellIcon name="help" size={18} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

export const ShellTopbar = memo(ShellTopbarComponent);
