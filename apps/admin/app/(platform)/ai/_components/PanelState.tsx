'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '@boletera/ui';
import { aiErrorMessage, isAiServiceUnavailable } from '../_lib/status';
import styles from '../ai.module.scss';

export function PanelSkeleton({
  height = 140,
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

export function PanelUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      size="sm"
      tone="neutral"
      illustration="inbox"
      title="Motor de IA no conectado"
      description="Este panel consulta un endpoint del ai-engine. Mientras no exista respuesta, no se muestran predicciones ni resúmenes inventados."
      hints={[
        'Contratos: packages/shared/src/ai-contracts.ts',
        'Sin endpoint activo = empty state honesto',
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
  if (isAiServiceUnavailable(error)) {
    return <PanelUnavailable onRetry={onRetry} />;
  }

  return (
    <EmptyState
      size="sm"
      tone="danger"
      illustration="error"
      title="No pudimos cargar esta sección"
      description={aiErrorMessage(error)}
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
        <span className={styles.srOnly}>Cargando inteligencia…</span>
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
