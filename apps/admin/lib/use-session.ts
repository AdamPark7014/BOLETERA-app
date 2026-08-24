'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSession,
  decodeSessionToken,
  getTokenStorage,
  type SessionSnapshot,
  type SessionUser,
} from './session';
import { http, logoutSession, revokeAllSessions } from './http';

import { PermissionKey } from '@boletera/shared';
import { hasCapability, type Capability } from './permissions';

export type Permission = string;

/** Maps legacy admin permission strings to API permission keys. */
const PERMISSION_ALIASES: Record<string, string> = {
  'event:read': PermissionKey.EVENTS_READ,
  'event:write': PermissionKey.EVENTS_PUBLISH,
  'order:read': PermissionKey.REPORTS_READ,
  'price:write': PermissionKey.VENUES_EDIT,
  'memberships.manage': PermissionKey.EVENTS_READ,
  'sponsorships.manage': PermissionKey.EVENTS_READ,
};

function normalizePermission(permission: Permission): string {
  return PERMISSION_ALIASES[permission] ?? permission;
}

function isCapability(value: string): value is Capability {
  return value.includes('.') && !value.includes(':');
}

export type SessionContextValue = {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  token: string | null;
  user: SessionUser | null;
  organizationId: string | null;
  role: string | null;
  can(permission: Permission): boolean;
  setToken(token: string): void;
  signOut(): Promise<void>;
  revokeAll(): Promise<void>;
  refresh(): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

type MeResponse = {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
  permissions?: readonly string[];
};

function sessionFromUser(user: MeResponse): SessionSnapshot {
  const token = getTokenStorage().getToken();
  const tokenSession = token ? decodeSessionToken(token) : null;
  return {
    token,
    expiresAt: tokenSession?.expiresAt ?? null,
    expired: false,
    user: {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
      permissions: user.permissions ?? [],
    },
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const refreshRequestId = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    try {
      const user = await http<MeResponse>('/auth/me');
      if (requestId !== refreshRequestId.current) return;
      if (user.organizationId) {
        getTokenStorage().setOrganizationId(user.organizationId);
      }
      setSession(sessionFromUser(user));
    } catch (error) {
      if (requestId === refreshRequestId.current) {
        clearSession();
        setSession(null);
      }
      throw error;
    } finally {
      if (requestId === refreshRequestId.current) setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const onStorage = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (session?.expiresAt === null || session?.expiresAt === undefined) return;
    const timer = window.setTimeout(
      () => void refresh().catch(() => undefined),
      Math.max(0, session.expiresAt - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [refresh, session?.expiresAt]);

  const setToken = useCallback((token: string) => {
    const decoded = decodeSessionToken(token);
    if (!decoded || decoded.expired) {
      clearSession();
      setSession(null);
      return;
    }
    getTokenStorage().setToken(token);
    if (decoded.user.organizationId) {
      getTokenStorage().setOrganizationId(decoded.user.organizationId);
    }
    setSession(decoded);
  }, []);

  const signOut = useCallback(async () => {
    refreshRequestId.current += 1;
    try {
      await logoutSession();
    } finally {
      setSession(null);
    }
  }, []);

  const revokeAll = useCallback(async () => {
    refreshRequestId.current += 1;
    try {
      await revokeAllSessions();
    } finally {
      setSession(null);
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!session) return false;
      if (session.user.role.toUpperCase() === SUPER_ADMIN_ROLE) return true;
      const normalized = normalizePermission(permission);
      if (
        session.user.permissions.includes(normalized) ||
        session.user.permissions.includes('*')
      ) {
        return true;
      }
      if (isCapability(permission)) {
        return hasCapability(session.user.role, permission);
      }
      return false;
    },
    [session],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status: !hydrated
        ? 'loading'
        : session
          ? 'authenticated'
          : 'unauthenticated',
      token: session?.token ?? null,
      user: session?.user ?? null,
      organizationId: session?.user.organizationId ?? null,
      role: session?.user.role ?? null,
      can,
      setToken,
      signOut,
      revokeAll,
      refresh,
    }),
    [can, hydrated, refresh, revokeAll, session, setToken, signOut],
  );

  return createElement(SessionContext.Provider, { value }, children);
}

/**
 * Sesión vacía para el prerenderizado.
 *
 * En el servidor no hay proveedor montado ni token que leer, así que lanzar
 * rompía el build de cualquier página estática que use el hook — y eso es un
 * fallo de infraestructura, no del código que lo llama. En el navegador se
 * conserva el error: ahí sí significa que alguien olvidó el proveedor.
 *
 * Todo sale apagado y sin permisos para que la primera pintura del servidor no
 * muestre acciones que el usuario quizá no tenga; al hidratar se resuelve.
 */
const SERVER_SESSION = {
  status: 'loading',
  token: null,
  user: null,
  organizationId: null,
  role: null,
  can: () => false,
  setToken: () => undefined,
  signOut: () => undefined,
  revokeAll: async () => undefined,
  refresh: async () => undefined,
} as unknown as SessionContextValue;

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) {
    if (typeof window === 'undefined') return SERVER_SESSION;
    throw new Error('useSession debe usarse dentro de SessionProvider');
  }
  return session;
}
