'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ActivityFeed, Badge, EmptyState } from '@boletera/ui';
import type { ActivityItem } from '@boletera/ui';
import type { PlatformOverview } from '@/lib/platform-api';
import {
  channelLabel,
  formatMxn,
  formatRelative,
  orderStatusLabel,
  orderStatusTone,
} from '../format';
import { recentOrders } from '../_lib/derive';
import { Panel, PanelError } from './Panel';
import styles from '../dashboard.module.scss';

type ActivityPanelProps = {
  overview: PlatformOverview | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

export function ActivityPanel({ overview, loading, error, onRetry }: ActivityPanelProps) {
  const orders = useMemo(() => recentOrders(overview, 8), [overview]);

  const items = useMemo<ActivityItem[]>(
    () =>
      orders.map((order) => ({
        id: order.publicId,
        actor: channelLabel(order.channel || 'WEB'),
        action: 'registró una orden en',
        target: order.eventTitle || 'un evento',
        timestamp: order.createdAt,
        detail: (
          <span className={styles.activityDetail}>
            <Badge tone={orderStatusTone(order.status)} size="sm" variant="soft">
              {orderStatusLabel(order.status)}
            </Badge>
            <span>
              {order.publicId} · {formatMxn(Number(order.totalAmount))}
            </span>
          </span>
        ),
      })),
    [orders],
  );

  return (
    <Panel
      headingId="activity-heading"
      title="Actividad reciente"
      description="Últimas órdenes de la organización"
      actions={
        <Link href="/orders" className={styles.textLink}>
          Ver órdenes
        </Link>
      }
      footer={
        orders[0] ? (
          <p className={styles.panelMeta}>
            Última orden {formatRelative(orders[0].createdAt)}
          </p>
        ) : null
      }
    >
      {error && !overview ? (
        <PanelError
          error={error}
          title="No se pudo cargar la actividad reciente"
          onRetry={onRetry}
        />
      ) : (
        <ActivityFeed
          items={items}
          loading={loading && !overview}
          loadingRows={5}
          groupByDay={false}
          label="Actividad reciente de órdenes"
          empty={
            <EmptyState
              size="sm"
              tone="neutral"
              illustration="inbox"
              title="Sin actividad"
              description="Las órdenes completadas aparecerán aquí en cuanto haya ventas."
              action={
                <Link href="/events" className={styles.ghostLink}>
                  Ver catálogo
                </Link>
              }
            />
          }
        />
      )}
    </Panel>
  );
}
