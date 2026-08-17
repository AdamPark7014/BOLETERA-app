'use client';

import type { ReactNode } from 'react';
import { HttpError } from '@/lib/http';

export function QueryLoading({
  label = 'Cargando información…',
}: {
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" style={{ padding: '2rem', color: '#737373' }}>
      {label}
    </div>
  );
}

export function QueryError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof HttpError || error instanceof Error
      ? error.message
      : 'No se pudo cargar la información.';
  return (
    <div role="alert" style={{ padding: '2rem', border: '1px solid #fecaca' }}>
      <strong>Algo salió mal</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function QueryEmpty({
  title = 'Sin información',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#737373' }}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function QueryState<T>({
  data,
  isPending,
  error,
  onRetry,
  isEmpty,
  children,
}: {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  isEmpty: (value: T) => boolean;
  children: (value: T) => ReactNode;
}) {
  if (isPending) return <QueryLoading />;
  if (error) return <QueryError error={error} onRetry={onRetry} />;
  if (data === undefined || isEmpty(data)) return <QueryEmpty />;
  return children(data);
}
