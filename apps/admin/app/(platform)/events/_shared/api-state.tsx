'use client';

/**
 * Estado de sesión y pantallas de error compartidas por las vistas de evento,
 * recinto, calendario, canales y lista de espera.
 *
 * Motivo: cada pantalla hacía `localStorage.getItem('boletera_token')` y, si el
 * token faltaba o la petición devolvía 401/403, se quedaba en «Cargando…» para
 * siempre o escupía el texto crudo del error de Nest. Con el JWT de 2 h
 * revocable, el 401 es un camino normal —no una excepción— y el
 * `OrgAccessGuard` endurecido devuelve 403 en cuanto falta `organizationId`.
 * Ambos casos necesitan una pantalla que diga qué pasó y qué hacer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, decodeToken, fetchMe, isTokenExpired, STORAGE_KEYS } from '@/lib/api';
import styles from './api-state.module.scss';

export type SessionState =
  | { status: 'loading'; token: null; orgId: null; role: null }
  | { status: 'anonymous'; token: null; orgId: null; role: null }
  /** Autenticado pero sin organización: toda llamada con `OrgAccessGuard` daría 403. */
  | { status: 'no-org'; token: string; orgId: null; role: string | null }
  | { status: 'ready'; token: string; orgId: string; role: string | null };

const LOADING: SessionState = { status: 'loading', token: null, orgId: null, role: null };

/**
 * Resuelve token + organización antes de que ninguna pantalla dispare peticiones.
 *
 * El orden importa: el JWT ya trae `organizationId`, así que decodificarlo evita
 * una ida y vuelta a `/auth/me` en el 95% de las cargas. `/auth/me` queda como
 * red de seguridad para tokens viejos emitidos sin esa reclamación.
 */
export function useSession(): SessionState & { refresh: () => void } {
  const [state, setState] = useState<SessionState>(LOADING);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (!token || isTokenExpired(token)) {
      // Un token vencido en almacenamiento es basura: limpiarlo evita que la
      // siguiente pantalla lo reintente y coleccione 401 innecesarios.
      if (token) localStorage.removeItem(STORAGE_KEYS.token);
      setState({ status: 'anonymous', token: null, orgId: null, role: null });
      return;
    }

    const claims = decodeToken(token);
    const role = claims?.role ?? localStorage.getItem(STORAGE_KEYS.role);
    const cachedOrg = localStorage.getItem(STORAGE_KEYS.org);
    const orgId = claims?.organizationId ?? cachedOrg ?? null;

    if (orgId) {
      if (orgId !== cachedOrg) localStorage.setItem(STORAGE_KEYS.org, orgId);
      setState({ status: 'ready', token, orgId, role: role ?? null });
      return;
    }

    setState(LOADING);
    fetchMe(token)
      .then((me) => {
        if (!alive) return;
        if (me.organizationId) {
          localStorage.setItem(STORAGE_KEYS.org, me.organizationId);
          setState({ status: 'ready', token, orgId: me.organizationId, role: me.role ?? role ?? null });
        } else {
          setState({ status: 'no-org', token, orgId: null, role: me.role ?? role ?? null });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.isUnauthorized) {
          setState({ status: 'anonymous', token: null, orgId: null, role: null });
        } else {
          setState({ status: 'no-org', token, orgId: null, role: role ?? null });
        }
      });

    return () => {
      alive = false;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

/** Petición con los tres estados que la interfaz necesita distinguir. */
export type AsyncState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
};

/**
 * `useEffect` + `fetch` + `catch(() => {})` era el patrón del repo, y por eso un
 * 403 dejaba la pantalla en blanco. Esto conserva el error para poder pintarlo.
 */
export function useApiResource<T>(
  loader: ((signal: AbortSignal) => Promise<T>) | null,
  deps: unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(loader));
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const fn = loaderRef.current;
    if (!fn) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fn(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

function loginHref(): string {
  if (typeof window === 'undefined') return '/login';
  const next = window.location.pathname + window.location.search;
  return `/login?next=${encodeURIComponent(next)}`;
}

type ErrorViewProps = {
  error: unknown;
  /** Qué intentaba hacer el usuario, para que el mensaje no sea genérico. */
  context?: string;
  onRetry?: () => void;
};

/**
 * Pantalla de error accionable.
 *
 * Nunca muestra el cuerpo crudo de Nest como título: el usuario de taquilla no
 * sabe qué es `Forbidden resource`. El detalle técnico queda en un `<details>`
 * plegado para quien tenga que reportarlo.
 */
export function ApiErrorView({ error, context, onRetry }: ErrorViewProps) {
  const apiError = error instanceof ApiError ? error : null;
  const status = apiError?.status ?? 0;

  let title = 'No se pudo cargar la información';
  let hint = 'Revisa tu conexión e inténtalo de nuevo.';
  let tone: 'auth' | 'denied' | 'missing' | 'fault' = 'fault';

  if (apiError?.isUnauthorized) {
    title = 'Tu sesión expiró';
    hint =
      'Los accesos duran 2 horas y pueden revocarse desde la organización. Inicia sesión otra vez para continuar; no perderás nada de lo publicado.';
    tone = 'auth';
  } else if (apiError?.isOrgDenied) {
    title = 'No tienes acceso a esta organización';
    hint =
      'Tu usuario no pertenece a la organización dueña de este recurso. Pide a un administrador que te invite, o cambia de cuenta.';
    tone = 'denied';
  } else if (apiError?.isForbidden) {
    title = 'Tu rol no permite ver esto';
    hint =
      'Necesitas un rol con permiso sobre este módulo (ADMIN, VENUE_MANAGER o SUPER_ADMIN según la pantalla). Pide la elevación a un administrador de tu organización.';
    tone = 'denied';
  } else if (apiError?.isNotFound) {
    title = 'No se encontró el recurso';
    hint = 'Puede que se haya eliminado o que el enlace esté mal. Vuelve al listado y entra otra vez.';
    tone = 'missing';
  } else if (status >= 500) {
    title = 'El servidor tuvo un problema';
    hint = 'No es culpa de tus datos. Reintenta en unos segundos; si persiste, avisa a soporte con el detalle técnico.';
    tone = 'fault';
  } else if (apiError) {
    title = apiError.userMessage;
    hint = 'Revisa los datos enviados e inténtalo de nuevo.';
  }

  return (
    <section className={styles.stateView} role="alert" aria-live="assertive" data-tone={tone}>
      <p className={styles.stateBadge}>
        <span aria-hidden="true">{tone === 'auth' ? '🔑' : tone === 'denied' ? '⛔' : tone === 'missing' ? '🔍' : '⚠'}</span>
        {status ? `Error ${status}` : 'Error'}
      </p>
      <h2 className={styles.stateTitle}>{title}</h2>
      {context && <p className={styles.stateContext}>Al {context}.</p>}
      <p className={styles.stateHint}>{hint}</p>

      <div className={styles.stateActions}>
        {tone === 'auth' ? (
          <Link href={loginHref()} className={styles.primaryAction}>
            Iniciar sesión
          </Link>
        ) : null}
        {onRetry && tone !== 'auth' && (
          <button type="button" className={styles.primaryAction} onClick={onRetry}>
            Reintentar
          </button>
        )}
        <Link href="/events" className={styles.secondaryAction}>
          Ir a eventos
        </Link>
      </div>

      {apiError && (
        <details className={styles.stateDetails}>
          <summary>Detalle técnico</summary>
          <p>
            <code>
              {apiError.status} · {apiError.path}
            </code>
          </p>
          <p>{apiError.message}</p>
        </details>
      )}
    </section>
  );
}

/** Pantalla para «autenticado, pero sin organización asignada». */
export function NoOrgView() {
  return (
    <section className={styles.stateView} role="alert" data-tone="denied">
      <p className={styles.stateBadge}>
        <span aria-hidden="true">🏢</span>
        Sin organización
      </p>
      <h2 className={styles.stateTitle}>Tu usuario no tiene organización asignada</h2>
      <p className={styles.stateHint}>
        Todas las pantallas de boletería piden una organización para filtrar el inventario, y el
        servidor rechaza las peticiones que no la traen. Pide a un administrador que te invite a la
        organización correcta; en cuanto aceptes la invitación esta pantalla funcionará sin más
        pasos.
      </p>
      <div className={styles.stateActions}>
        <Link href="/settings/organization" className={styles.primaryAction}>
          Ver organización
        </Link>
        <Link href={loginHref()} className={styles.secondaryAction}>
          Cambiar de cuenta
        </Link>
      </div>
    </section>
  );
}

/** Pantalla para «no hay sesión»: sin esto la vista se queda en «Cargando…». */
export function AnonymousView() {
  return (
    <section className={styles.stateView} role="alert" data-tone="auth">
      <p className={styles.stateBadge}>
        <span aria-hidden="true">🔑</span>
        Sesión requerida
      </p>
      <h2 className={styles.stateTitle}>Necesitas iniciar sesión</h2>
      <p className={styles.stateHint}>
        No hay una sesión válida en este navegador, o la que había ya venció.
      </p>
      <div className={styles.stateActions}>
        <Link href={loginHref()} className={styles.primaryAction}>
          Iniciar sesión
        </Link>
      </div>
    </section>
  );
}

/** Estado de carga anunciado a lectores de pantalla (no solo un texto suelto). */
export function LoadingView({ label = 'Cargando…' }: { label?: string }) {
  return (
    <p className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      {label}
    </p>
  );
}

/**
 * Envoltorio que resuelve sesión → carga → error → contenido.
 * Evita repetir la cascada de `if` en cada pantalla.
 */
export function ApiStateBoundary({
  session,
  loading,
  error,
  context,
  onRetry,
  loadingLabel,
  children,
}: {
  session: SessionState;
  loading?: boolean;
  error?: unknown;
  context?: string;
  onRetry?: () => void;
  loadingLabel?: string;
  children: React.ReactNode;
}) {
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  // Un 401 sobrevenido pesa más que el estado de sesión en memoria.
  if (error) return <ApiErrorView error={error} context={context} onRetry={onRetry} />;
  if (session.status === 'loading' || loading) return <LoadingView label={loadingLabel} />;
  return <>{children}</>;
}
