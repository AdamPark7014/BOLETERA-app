'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import styles from './PanelState.module.scss';

/**
 * Estados de panel: cargando, error, servicio caído y vacío.
 *
 * ── Por qué existe aquí ──
 *
 * Este mismo componente estaba copiado CUATRO veces —`ai`, `analytics`,
 * `memberships`, `sponsorships`— con 570 líneas entre las cuatro y 97 puntos de
 * uso. Las diferencias reales eran tres: qué error significa «el servicio no
 * está conectado», qué texto describe ese caso, y qué endpoints listar. Todo lo
 * demás era idéntico, así que cada arreglo había que hacerlo cuatro veces y en
 * la práctica se hacía en una.
 *
 * ── Por qué una fábrica y no un componente con props ──
 *
 * `createPanelState(adaptador)` devuelve los componentes ya atados a su módulo.
 * El archivo de cada sección pasa de 142 líneas a diez, y los 97 puntos de uso
 * NO CAMBIAN: siguen escribiendo `<PanelState …>` con los mismos props. Una
 * consolidación que obligue a tocar 97 llamadas es una invitación a la
 * regresión; ésta no toca ninguna.
 */

export type PanelStateAdapter = {
  /**
   * ¿Este error significa «el servicio todavía no existe» en vez de «falló»?
   *
   * La distinción importa: un 404 de un módulo que aún no se despliega no es un
   * fallo que el usuario deba reintentar con angustia, y merece un mensaje
   * distinto al de un error real.
   */
  isUnavailable: (error: unknown) => boolean;
  /** Mensaje legible para un error real. */
  errorMessage: (error: unknown) => string;
  /** Título cuando el servicio no está conectado. */
  unavailableTitle: string;
  /** Qué consulta este panel y qué se verá cuando responda. */
  unavailableDescription: string;
  /** Endpoints concretos, para que quien lo lea sepa qué falta levantar. */
  unavailableHints?: readonly string[];
  /**
   * Renglones de texto del esqueleto. Por omisión 2, que es lo que usaban tres
   * de las cuatro secciones; `ai` usaba 3 porque sus tarjetas son más altas y
   * un esqueleto más corto que el contenido produce un salto al cargar.
   */
  skeletonLines?: number;
};

export type PanelStateComponents = {
  PanelSkeleton: (props: { height?: number; lines?: number }) => ReactNode;
  PanelUnavailable: (props: { title?: string; onRetry?: () => void }) => ReactNode;
  PanelError: (props: { error: unknown; onRetry?: () => void }) => ReactNode;
  PanelEmpty: (props: {
    title: string;
    description: string;
    hints?: readonly string[];
    action?: ReactNode;
  }) => ReactNode;
  PanelState: <T>(props: {
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
  }) => ReactNode;
};

export function createPanelState(adapter: PanelStateAdapter): PanelStateComponents {
  function PanelSkeleton({
    height = 120,
    lines = adapter.skeletonLines ?? 2,
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
            // El último renglón va corto: imita cómo termina un párrafo real y
            // evita que el esqueleto parezca una tabla.
            width={index === lines - 1 ? '48%' : '72%'}
          />
        ))}
      </div>
    );
  }

  function PanelUnavailable({
    title = adapter.unavailableTitle,
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
        description={adapter.unavailableDescription}
        hints={adapter.unavailableHints}
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

  function PanelError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    // Servicio no conectado ≠ error: el primero se explica, el segundo se reintenta.
    if (adapter.isUnavailable(error)) {
      return <PanelUnavailable onRetry={onRetry} />;
    }
    return (
      <EmptyState
        size="sm"
        tone="danger"
        illustration="error"
        title="No pudimos cargar esta sección"
        description={adapter.errorMessage(error)}
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

  function PanelEmpty({
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

  function PanelState<T>({
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
      // `aria-busy` + texto solo para lector: quien no ve el esqueleto necesita
      // que alguien le diga que está cargando.
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

  return { PanelSkeleton, PanelUnavailable, PanelError, PanelEmpty, PanelState };
}
