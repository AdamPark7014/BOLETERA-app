'use client';

import { memo } from 'react';
import { Tooltip } from '@boletera/ui';
import { ShellIcon } from './icons';
import { useTheme } from './use-theme';
import styles from '@/app/(platform)/shell.module.scss';

function ShellThemeToggleComponent() {
  const { preference, resolved, cycle } = useTheme();

  const label =
    preference === 'system'
      ? `Tema del sistema (${resolved === 'dark' ? 'oscuro' : 'claro'})`
      : preference === 'dark'
        ? 'Tema oscuro'
        : 'Tema claro';

  const icon = preference === 'system' ? 'monitor' : preference === 'dark' ? 'moon' : 'sun';

  return (
    <Tooltip content={`${label} — clic para cambiar`} placement="bottom">
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`${label}. Cambiar tema`}
        onClick={cycle}
      >
        <ShellIcon name={icon} size={18} />
      </button>
    </Tooltip>
  );
}

export const ShellThemeToggle = memo(ShellThemeToggleComponent);
