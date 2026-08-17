'use client';

import Link from 'next/link';
import { EmptyState } from '@boletera/ui';
import type { MetricsBreakdown } from '@boletera/shared';
import { formatCount, formatMxn } from '../format';
import { channelRows } from '../_lib/derive';
import { ListSkeleton, Panel, PanelError } from './Panel';
import styles from '../dashboard.module.scss';

type ChannelsPanelProps = {
  breakdown: MetricsBreakdown | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

const SEGMENTS = [
  styles.channelSeg0,
  styles.channelSeg1,
  styles.channelSeg2,
  styles.channelSeg3,
  styles.channelSeg4,
] as const;

export function ChannelsPanel({ breakdown, loading, error, onRetry }: ChannelsPanelProps) {
  const channels = channelRows(breakdown);
  const total = breakdown?.total ?? channels.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <Panel
      headingId="channels-heading"
      title="Canales"
      description="Distribución de ingresos del periodo"
      actions={
        <Link href="/channels" className={styles.textLink}>
          Configurar
        </Link>
      }
      footer={
        channels.length > 0 ? (
          <p className={styles.panelMeta}>Total {formatMxn(total)}</p>
        ) : null
      }
    >
      {loading && !breakdown ? (
        <ListSkeleton rows={4} height={48} />
      ) : error && !breakdown ? (
        <PanelError
          error={error}
          title="No se pudo cargar el desglose por canal"
          onRetry={onRetry}
        />
      ) : channels.length === 0 ? (
        <EmptyState
          size="sm"
          tone="neutral"
          illustration="inbox"
          title="Sin ventas por canal"
          description="Las órdenes aparecerán aquí cuando haya actividad en web, taquilla u otros canales."
        />
      ) : (
        <>
          <div
            className={styles.channelBar}
            role="img"
            aria-label={channels
              .map((c) => `${c.label} ${c.percent}%`)
              .join(', ')}
          >
            {channels.map((channel, index) => (
              <span
                key={channel.key}
                className={SEGMENTS[index % SEGMENTS.length]}
                style={{ width: `${Math.max(channel.percent, 0)}%` }}
                title={`${channel.label} ${channel.percent}%`}
              />
            ))}
          </div>

          <ul className={styles.channelList}>
            {channels.map((channel, index) => (
              <li key={channel.key}>
                <span
                  className={`${styles.channelDot} ${SEGMENTS[index % SEGMENTS.length]}`}
                  aria-hidden="true"
                />
                <span className={styles.channelName}>{channel.label}</span>
                <span className={styles.channelOrders}>
                  {channel.orders > 0 ? `${formatCount(channel.orders)} órdenes` : '—'}
                </span>
                <strong className={styles.channelRev}>{formatMxn(channel.revenue)}</strong>
                <span className={styles.channelPct}>{channel.percent}%</span>
                <div className={styles.channelTrack} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, channel.percent)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
