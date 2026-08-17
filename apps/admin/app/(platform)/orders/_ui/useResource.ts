'use client';

/**
 * Carga de datos con estados honestos.
 *
 * Todas las pantallas de dinero hacían `.catch(() => {})` y se quedaban con la
 * lista vacía. El resultado: "sin órdenes", "el token venció" y "no perteneces a
 * esta organización" se veían idénticos — una tabla en blanco. Con el
 * `OrgAccessGuard` endurecido (ya no exime a ADMIN, ya no aprueba peticiones sin
 * `organizationId`) y el JWT de 2 h revocable, el 401/403 dejó de ser
 * excepcional: es camino normal y hay que pintarlo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, fetchMe, getStoredToken, isTokenExpired, STORAGE_KEYS } from '@/lib/api';

export type SessionState =
  /** Aún resolviendo token / organización. */
  | { phase: 'loading' }
  /** Sin token en el navegador, o token ya vencido. */
  | { phase: 'anonymous' }
  /** Autenticado, pero el usuario no está asociado a ninguna organización. */
  | { phase: 'no-org'; token: string }
  | { phase: 'ready'; token: string; orgId: string };

/**
 * Resuelve token + `organizationId`.
 *
 * El `organizationId` faltante era la causa raíz de la mayoría de los 403: el
 * callback OAuth guardaba la organización con otra clave, así que tras SSO
 * `boletera_org` quedaba vacío y cada pantalla mandaba la URL sin org. Aquí se
 * hace un solo intento contra `/auth/me` y el resultado se cachea.
 */
export function useAdminSession(): SessionState {
  const [state, setState] = useState<SessionState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token || isTokenExpired(token)) {
      setState({ phase: 'anonymous' });
      return;
    }
    const cached = localStorage.getItem(STORAGE_KEYS.org);
    if (cached) {
      setState({ phase: 'ready', token, orgId: cached });
      return;
    }
    fetchMe(token)
      .then((me) => {
        if (cancelled) return;
        if (me.organizationId) {
          localStorage.setItem(STORAGE_KEYS.org, me.organizationId);
          setState({ phase: 'ready', token, orgId: me.organizationId });
        } else {
          setState({ phase: 'no-org', token });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.isUnauthorized) setState({ phase: 'anonymous' });
        else setState({ phase: 'no-org', token });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export type ResourceState<T> =
  | { phase: 'loading' }
  /** No hay sesión utilizable: no se llegó a pedir nada. */
  | { phase: 'anonymous' }
  /** Se requiere organización y el usuario no tiene ninguna. */
  | { phase: 'no-org' }
  | { phase: 'error'; error: ApiError | Error }
  | { phase: 'ready'; data: T };

export type Resource<T> = {
  state: ResourceState<T>;
  /** Vuelve a pedir el recurso (tras una acción o tras un fallo). */
  reload: () => void;
  /** Muta el dato en memoria sin refetch (respuesta optimista de una acción). */
  patch: (updater: (current: T) => T) => void;
  /** `true` mientras se recarga con datos previos ya en pantalla. */
  refreshing: boolean;
};

export type LoaderContext = { token: string; orgId: string; signal: AbortSignal };

type Options = {
  /**
   * `false` para rutas que el JWT ya acota por sí solo (las de `/admin`). Las
   * de `/analytics/promoters/:organizationId` y `/reports/.../:organizationId`
   * necesitan la organización sí o sí: sin ella el guard devuelve 403.
   */
  requiresOrg?: boolean;
  deps?: unknown[];
};

export function useResource<T>(
  loader: (ctx: LoaderContext) => Promise<T>,
  options: Options = {},
): Resource<T> {
  const { requiresOrg = true, deps = [] } = options;
  const session = useAdminSession();
  const [state, setState] = useState<ResourceState<T>>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const hasDataRef = useRef(false);
  hasDataRef.current = state.phase === 'ready';

  const token = session.phase === 'ready' || session.phase === 'no-org' ? session.token : null;
  const orgId = session.phase === 'ready' ? session.orgId : null;
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    if (session.phase === 'loading') return;
    if (!token) {
      setState({ phase: 'anonymous' });
      return;
    }
    if (requiresOrg && !orgId) {
      setState({ phase: 'no-org' });
      return;
    }

    const controller = new AbortController();
    if (hasDataRef.current) setRefreshing(true);
    loaderRef
      .current({ token, orgId: orgId ?? '', signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'ready', data });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', error: e instanceof Error ? e : new Error(String(e)) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });

    return () => controller.abort();
  }, [session.phase, token, orgId, requiresOrg, nonce, depsKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const patch = useCallback((updater: (current: T) => T) => {
    setState((prev) =>
      prev.phase === 'ready' ? { phase: 'ready', data: updater(prev.data) } : prev,
    );
  }, []);

  return useMemo(() => ({ state, reload, patch, refreshing }), [state, reload, patch, refreshing]);
}
