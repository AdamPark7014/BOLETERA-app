'use client';

/**
 * Estados compartidos de las pantallas de dinero.
 *
 * Regla transversal: **vacío ≠ falló ≠ sin permiso**. Una tabla en blanco que
 * en realidad era un 403 hace que soporte le diga al promotor "no tienes
 * ventas" cuando lo que pasa es que su JWT ya no cubre esa organización.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import type { ResourceState } from './useResource';
import styles from './states.module.scss';

function IconAlert() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 13h4l1.5 3h7L17 13h4M3 13l2.4-7.3A2 2 0 0 1 7.3 4.3h9.4a2 2 0 0 1 1.9 1.4L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Placeholder de carga con altura estable (no salta el layout al llegar el dato). */
export function LoadingBlock({ rows = 4, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <span className={styles.srOnly}>{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skelRow} aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyBlock({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.block}>
      <span className={styles.icon}>
        <IconInbox />
      </span>
      <p className={styles.title}>{title}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
      {action && <div className={styles.actionRow}>{action}</div>}
    </div>
  );
}

/**
 * Traduce el fallo a algo accionable. Nunca muestra el código HTTP crudo: el
 * usuario de soporte no puede hacer nada con un "403 Forbidden", pero sí con
 * "pide acceso a esta organización".
 */
export function ErrorBlock({
  error,
  onRetry,
  context,
}: {
  error: Error;
  onRetry?: () => void;
  /** Qué se estaba cargando, p. ej. "las órdenes". */
  context?: string;
}) {
  const api = error instanceof ApiError ? error : null;
  const forbidden = api?.isForbidden ?? false;
  const unauthorized = api?.isUnauthorized ?? false;

  const title = unauthorized
    ? 'Tu sesión expiró'
    : api?.isOrgDenied
      ? 'No tienes acceso a esta organización'
      : forbidden
        ? 'Tu rol no permite ver esta información'
        : context
          ? `No se pudieron cargar ${context}`
          : 'No se pudo cargar la información';

  const hint = unauthorized
    ? 'Los accesos duran 2 horas y pueden revocarse. Vuelve a iniciar sesión para continuar.'
    : api?.isOrgDenied
      ? 'Pide a un administrador que te agregue a la organización del evento que intentas ver.'
      : forbidden
        ? 'Pide a un administrador que eleve tu rol si necesitas consultarla.'
        : (api?.userMessage ?? 'Revisa tu conexión e inténtalo de nuevo.');

  return (
    <div className={styles.block} role="alert">
      <span className={forbidden || unauthorized ? styles.iconWarn : styles.iconError}>
        {forbidden || unauthorized ? <IconLock /> : <IconAlert />}
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.hint}>{hint}</p>
      <div className={styles.actionRow}>
        {unauthorized ? (
          <Link href="/login" className={styles.action}>
            Iniciar sesión
          </Link>
        ) : (
          onRetry && (
            <button type="button" className={styles.action} onClick={onRetry}>
              Reintentar
            </button>
          )
        )}
      </div>
    </div>
  );
}

export function AnonymousBlock() {
  return (
    <div className={styles.block} role="alert">
      <span className={styles.iconWarn}>
        <IconLock />
      </span>
      <p className={styles.title}>Necesitas iniciar sesión</p>
      <p className={styles.hint}>Tu acceso no está activo o ya venció.</p>
      <div className={styles.actionRow}>
        <Link href="/login" className={styles.action}>
          Iniciar sesión
        </Link>
      </div>
    </div>
  );
}

export function NoOrgBlock() {
  return (
    <div className={styles.block} role="alert">
      <span className={styles.iconWarn}>
        <IconLock />
      </span>
      <p className={styles.title}>Tu usuario no pertenece a ninguna organización</p>
      <p className={styles.hint}>
        Los reportes de dinero se consultan siempre por organización. Pide una invitación al
        administrador del promotor para poder verlos.
      </p>
    </div>
  );
}

/**
 * Envoltorio que resuelve todos los estados no-felices y solo llama a
 * `children` cuando hay dato.
 */
export function ResourceView<T>({
  resource,
  context,
  loadingRows,
  children,
}: {
  resource: { state: ResourceState<T>; reload: () => void };
  context?: string;
  loadingRows?: number;
  children: (data: T) => ReactNode;
}) {
  const { state, reload } = resource;
  if (state.phase === 'loading') return <LoadingBlock rows={loadingRows} />;
  if (state.phase === 'anonymous') return <AnonymousBlock />;
  if (state.phase === 'no-org') return <NoOrgBlock />;
  if (state.phase === 'error')
    return <ErrorBlock error={state.error} onRetry={reload} context={context} />;
  return <>{children(state.data)}</>;
}

export type NoticeTone = 'info' | 'warn' | 'danger' | 'neutral';

/** Banda de aviso; usa icono + texto, nunca solo color. */
export function Notice({
  tone = 'neutral',
  title,
  children,
  actions,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const cls =
    tone === 'warn'
      ? styles.noticeWarn
      : tone === 'danger'
        ? styles.noticeDanger
        : tone === 'info'
          ? styles.noticeInfo
          : styles.notice;
  return (
    <div className={cls} role={tone === 'danger' ? 'alert' : 'status'}>
      <span aria-hidden="true">
        <IconAlert />
      </span>
      <div className={styles.noticeBody}>
        {title && <strong>{title}</strong>}
        {children}
        {actions && <div className={styles.noticeActions}>{actions}</div>}
      </div>
    </div>
  );
}

export const stateStyles = styles;
