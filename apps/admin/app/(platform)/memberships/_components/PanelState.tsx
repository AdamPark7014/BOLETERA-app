'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '@boletera/ui';
import { isMembershipsUnavailable, membershipsErrorMessage } from '../_lib/status';
import styles from '../memberships.module.scss';

export function PanelSkeleton({ height = 120 }: { height?: number }) {
  return (
    <div className={styles.panelSkeleton} aria-hidden="true">
      <Skeleton height={height} radius={10} />
      <Skeleton shape="text" width="72%" />
      <Skeleton shape="text" width="48%" />
    </div>
  );
}

export function PanelUnavailable({
  title = 'API de membresías no conectada',
  onRetry,
}: {
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      size="sm"
      tone="neutral"
      illustration="inbox"
      title={title}
      description="Este panel consulta contratos reales de /memberships. Mientras no exista respuesta, no se muestran cifras inventadas."
      hints={[
        'GET /memberships/organization/:orgId/plans',
        'GET /memberships/organization/:orgId/metrics',
      ]}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        ) : null
      }
    />
  );
}

export function PanelError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  if (isMembershipsUnavailable(error)) {
    return <PanelUnavailable onRetry={onRetry} />;
  }
  return (
    <EmptyState
      size="sm"
      tone="danger"
      illustration="error"
      title="No pudimos cargar esta sección"
      description={membershipsErrorMessage(error)}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        ) : null
      }
    />
  );
}

export function PanelEmpty({
  title,
  description,
  hints,
  action,
}: {
  title: string;
  description: string;
  hints?: readonly string[];
  action?: ReactNode;
}) {
  return (
    <EmptyState
      size="sm"
      tone="neutral"
      illustration="chart"
      title={title}
      description={description}
      hints={hints}
      action={action}
    />
  );
}

export function PanelState<T>({
  data,
  isPending,
  error,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyHints,
  emptyAction,
  children,
}: {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  isEmpty: (value: T) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyHints?: readonly string[];
  emptyAction?: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className={styles.srOnly}>Cargando…</span>
        <PanelSkeleton />
      </div>
    );
  }
  if (error) return <PanelError error={error} onRetry={onRetry} />;
  if (data === undefined || isEmpty(data)) {
    return (
      <PanelEmpty
        title={emptyTitle}
        description={emptyDescription}
        hints={emptyHints}
        action={emptyAction}
      />
    );
  }
  return <>{children(data)}</>;
}
