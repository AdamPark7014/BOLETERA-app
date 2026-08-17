'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useState } from 'react';
import { Avatar, Popover } from '@boletera/ui';
import { useSession } from '@/lib/use-session';
import { ShellIcon } from './icons';
import { roleLabel } from './nav-config';
import { useTheme } from './use-theme';
import styles from '@/app/(platform)/shell.module.scss';

type ShellUserMenuProps = {
  linkProps: (href: string) => {
    onMouseEnter: () => void;
    onFocus: () => void;
  };
  onOpenShortcuts: () => void;
};

function ShellUserMenuComponent({ linkProps, onOpenShortcuts }: ShellUserMenuProps) {
  const router = useRouter();
  const { user, role, organizationId, signOut, revokeAll } = useSession();
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'out' | 'all' | null>(null);

  const email = user?.email ?? '';
  const displayName = email || 'Admin';

  const handleSignOut = useCallback(async () => {
    setBusy('out');
    try {
      await signOut();
      router.push('/login');
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }, [router, signOut]);

  const handleRevokeAll = useCallback(async () => {
    setBusy('all');
    try {
      await revokeAll();
      router.push('/login');
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }, [revokeAll, router]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="top"
      alignment="start"
      width={280}
      label="Menú de usuario"
      trigger={({ open: isOpen }) => (
        <button
          type="button"
          className={styles.userTrigger}
          aria-label="Menú de cuenta"
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          <Avatar name={displayName} size="sm" decorative />
          <span className={styles.userTriggerMeta}>
            <strong>{displayName}</strong>
            <span>{roleLabel(role)}</span>
          </span>
          <ShellIcon name="chevronDown" size={14} />
        </button>
      )}
    >
      <div className={styles.userMenu} role="menu">
        <div className={styles.userMenuHeader}>
          <Avatar name={displayName} size="md" />
          <div>
            <strong>{displayName}</strong>
            <span>{roleLabel(role)}</span>
          </div>
        </div>

        <div className={styles.userMenuSection}>
          <Link
            href="/settings/organization"
            role="menuitem"
            className={styles.userMenuItem}
            onClick={() => setOpen(false)}
            {...linkProps('/settings/organization')}
          >
            <ShellIcon name="user" size={16} />
            Perfil y equipo
          </Link>
          {organizationId ? (
            <Link
              href="/settings/organization"
              role="menuitem"
              className={styles.userMenuItem}
              onClick={() => setOpen(false)}
              {...linkProps('/settings/organization')}
            >
              <ShellIcon name="building" size={16} />
              Organización
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={styles.userMenuItem}
            onClick={() => {
              setOpen(false);
              onOpenShortcuts();
            }}
          >
            <ShellIcon name="keyboard" size={16} />
            Atajos de teclado
          </button>
        </div>

        <div className={styles.userMenuSection}>
          <p className={styles.userMenuLabel}>Tema</p>
          <div className={styles.themeRow} role="group" aria-label="Preferencia de tema">
            {(
              [
                ['system', 'Sistema', 'monitor'],
                ['light', 'Claro', 'sun'],
                ['dark', 'Oscuro', 'moon'],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={`${styles.themeChip} ${preference === value ? styles.themeChipActive : ''}`}
                aria-pressed={preference === value}
                onClick={() => setPreference(value)}
              >
                <ShellIcon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.userMenuSection}>
          <button
            type="button"
            role="menuitem"
            className={styles.userMenuItem}
            disabled={busy !== null}
            onClick={() => {
              void handleSignOut();
            }}
          >
            <ShellIcon name="logout" size={16} />
            {busy === 'out' ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.userMenuItem} ${styles.userMenuDanger}`}
            disabled={busy !== null}
            onClick={() => {
              void handleRevokeAll();
            }}
          >
            <ShellIcon name="close" size={16} />
            {busy === 'all' ? 'Revocando…' : 'Cerrar todas las sesiones'}
          </button>
        </div>
      </div>
    </Popover>
  );
}

export const ShellUserMenu = memo(ShellUserMenuComponent);
