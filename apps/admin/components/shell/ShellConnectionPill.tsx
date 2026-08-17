'use client';

import { memo } from 'react';
import { StatusDot, Tooltip } from '@boletera/ui';
import { useConnectionStatus, type ConnectionTone } from './use-connection-status';
import styles from '@/app/(platform)/shell.module.scss';

function toneToStatus(tone: ConnectionTone): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (tone) {
    case 'online':
      return 'success';
    case 'connecting':
      return 'warning';
    case 'error':
      return 'danger';
    case 'offline':
    default:
      return 'neutral';
  }
}

function ShellConnectionPillComponent() {
  const connection = useConnectionStatus();

  return (
    <Tooltip content={connection.detail} placement="bottom">
      <div
        className={`${styles.statusPill} ${styles[`statusPill_${connection.tone}`]}`}
        role="status"
        aria-live="polite"
        aria-label={connection.detail}
      >
        <StatusDot tone={toneToStatus(connection.tone)} pulse={connection.tone === 'connecting'} />
        <span>{connection.label}</span>
      </div>
    </Tooltip>
  );
}

export const ShellConnectionPill = memo(ShellConnectionPillComponent);
