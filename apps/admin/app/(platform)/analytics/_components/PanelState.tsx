'use client';

import type { ReactNode } from 'react';
import { Button } from '@boletera/ui/src/components/Button';
import { EmptyState } from '@boletera/ui/src/components/EmptyState';
import { Skeleton } from '@boletera/ui/src/components/Skeleton';
import { HttpError } from '@/lib/http';
import styles from '../analytics.module.scss';

function errorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof Error) return error.message;
  return 'No se pudieron cargar las métricas.';
}

export function PanelSkeleton({
  height = 180,
  lines = 3,
}: {
  height?: number;
  lines?: number;
}) {
  return (
    <div className={styles.panelSkeleton} aria-hidden="true">
      <Skeleton height={height} radius={10} />
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton
          key={index}
          shape="text"
          width={index === lines - 1 ? '48%' : '72%'}
          delay={index * 70}
        />
      ))}
    </div>
  );
}

export function PanelError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      size="sm"
      tone="danger"
      illustration="error"
      title="No pudimos cargar esta sección"
      description={errorMessage(error)}
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

/**
 * Contenedor de estados de un panel del dashboard. Anuncia la carga con
 * `aria-busy` una sola vez; los skeletons internos van `aria-hidden`.
 */
export function PanelState<T>({
  data,
  isPending,
  error,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyHints,
  skeleton,
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
  skeleton?: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className={styles.srOnly}>Cargando métricas…</span>
        {skeleton ?? <PanelSkeleton />}
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
      />
    );
  }

  return <>{children(data)}</>;
}
