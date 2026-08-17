'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  Badge,
  EmptyState,
  Popover,
  Skeleton,
} from '@boletera/ui';
import type { MetricsAlert, MetricsAlertSeverity } from '@boletera/shared';
import { ShellIcon } from './icons';
import {
  domainLabel,
  resolveAlertHref,
  severityLabel,
} from './alert-routes';
import { useShellAlerts } from './use-shell-alerts';
import styles from '@/app/(platform)/shell.module.scss';

function severityTone(
  severity: MetricsAlertSeverity,
): 'danger' | 'warning' | 'info' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function groupByDomain(alerts: readonly MetricsAlert[]): Map<string, MetricsAlert[]> {
  const map = new Map<string, MetricsAlert[]>();
  for (const alert of alerts) {
    const key = alert.domain;
    const bucket = map.get(key);
    if (bucket) bucket.push(alert);
    else map.set(key, [alert]);
  }
  return map;
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `Hace ${days} d`;
}

type ShellNotificationsProps = {
  linkProps: (href: string) => {
    onMouseEnter: () => void;
    onFocus: () => void;
  };
};

function ShellNotificationsComponent({ linkProps }: ShellNotificationsProps) {
  const router = useRouter();
  const {
    alerts,
    unreadCount,
    isPending,
    isError,
    refetch,
    markRead,
    markAllRead,
    isRead,
  } = useShellAlerts();
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => groupByDomain(alerts), [alerts]);

  const openAlert = useCallback(
    (alert: MetricsAlert) => {
      markRead(alert.id);
      setOpen(false);
      router.push(resolveAlertHref(alert));
    },
    [markRead, router],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom"
      alignment="end"
      width={380}
      label="Centro de notificaciones"
      trigger={({ open: isOpen }) => (
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={
            unreadCount > 0
              ? `Notificaciones, ${unreadCount} sin leer`
              : 'Notificaciones'
          }
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          <ShellIcon name="bell" size={18} />
          {unreadCount > 0 ? (
            <span className={styles.iconBadge} aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      )}
    >
      <div className={styles.notifyPanel}>
        <header className={styles.notifyHeader}>
          <div>
            <strong>Notificaciones</strong>
            <p>Alertas operativas de métricas</p>
          </div>
          {unreadCount > 0 ? (
            <button type="button" className={styles.notifyAction} onClick={markAllRead}>
              Marcar leídas
            </button>
          ) : null}
        </header>

        {isError ? (
          <div className={styles.notifyEmpty}>
            <EmptyState
              size="sm"
              tone="danger"
              illustration="error"
              title="No se pudieron cargar"
              description="Revisa la conexión e inténtalo de nuevo."
              action={
                <button type="button" className={styles.notifyAction} onClick={refetch}>
                  Reintentar
                </button>
              }
            />
          </div>
        ) : null}

        {isPending && !isError ? (
          <div className={styles.notifyList} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} shape="rect" height={64} delay={i * 50} />
            ))}
          </div>
        ) : null}

        {!isPending && !isError && alerts.length === 0 ? (
          <div className={styles.notifyEmpty}>
            <EmptyState
              size="sm"
              tone="success"
              illustration="success"
              title="Todo en orden"
              description="No hay alertas activas en el periodo actual."
            />
          </div>
        ) : null}

        {!isPending && !isError && alerts.length > 0 ? (
          <div className={styles.notifyList} role="list">
            {[...grouped.entries()].map(([domain, items]) => (
              <section key={domain} className={styles.notifyGroup} aria-label={domainLabel(domain)}>
                <p className={styles.notifyGroupLabel}>{domainLabel(domain)}</p>
                {items.map((alert) => {
                  const href = resolveAlertHref(alert);
                  const read = isRead(alert.id);
                  return (
                    <div
                      key={alert.id}
                      role="listitem"
                      className={`${styles.notifyItem} ${read ? styles.notifyItemRead : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.notifyItemBtn}
                        onClick={() => openAlert(alert)}
                        onMouseEnter={() => linkProps(href).onMouseEnter()}
                        onFocus={() => linkProps(href).onFocus()}
                      >
                        <div className={styles.notifyItemTop}>
                          <Badge tone={severityTone(alert.severity)} variant="soft" size="sm">
                            {severityLabel(alert.severity)}
                          </Badge>
                          <time dateTime={alert.detectedAt}>{formatRelative(alert.detectedAt)}</time>
                        </div>
                        <strong>{alert.title}</strong>
                        <span>{alert.explanation}</span>
                      </button>
                      {!read ? (
                        <button
                          type="button"
                          className={styles.notifyMark}
                          aria-label="Marcar como leída"
                          onClick={() => markRead(alert.id)}
                        >
                          <ShellIcon name="check" size={14} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : null}

        <footer className={styles.notifyFooter}>
          <Link
            href="/analytics"
            className={styles.notifyFooterLink}
            onClick={() => setOpen(false)}
            {...linkProps('/analytics')}
          >
            Ver analítica
          </Link>
        </footer>
      </div>
    </Popover>
  );
}

export const ShellNotifications = memo(ShellNotificationsComponent);
