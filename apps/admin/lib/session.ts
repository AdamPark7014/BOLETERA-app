export const TOKEN_KEY = 'boletera_token';
export const ORGANIZATION_KEY = 'boletera_org';

export interface TokenStorage {
  getToken(): string | null;
  setToken(token: string): void;
  clear(): void;
  getOrganizationId(): string | null;
  setOrganizationId(organizationId: string): void;
}

export type SessionUser = {
  id: string | null;
  email: string;
  organizationId: string | null;
  role: string;
  permissions: readonly string[];
};

export type SessionSnapshot = {
  token: string | null;
  user: SessionUser;
  expiresAt: number | null;
  expired: boolean;
};

type JwtPayload = {
  sub?: unknown;
  id?: unknown;
  email?: unknown;
  organizationId?: unknown;
  organization_id?: unknown;
  orgId?: unknown;
  role?: unknown;
  permissions?: unknown;
  exp?: unknown;
};

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export const localTokenStorage: TokenStorage = {
  getToken: () => browserStorage()?.getItem(TOKEN_KEY) ?? null,
  setToken: (token) => browserStorage()?.setItem(TOKEN_KEY, token),
  clear: () => {
    browserStorage()?.removeItem(TOKEN_KEY);
    browserStorage()?.removeItem(ORGANIZATION_KEY);
    browserStorage()?.removeItem('boletera_org_id');
  },
  getOrganizationId: () =>
    browserStorage()?.getItem(ORGANIZATION_KEY) ??
    browserStorage()?.getItem('boletera_org_id') ??
    null,
  setOrganizationId: (organizationId) =>
    browserStorage()?.setItem(ORGANIZATION_KEY, organizationId),
};

let transientAccessToken: string | null = null;

/**
 * Cookie-first storage: only reads `boletera_token` as a temporary legacy
 * fallback. A new token lives in memory and removes the persisted legacy token.
 */
export const cookieTokenStorage: TokenStorage = {
  getToken: () =>
    transientAccessToken ?? browserStorage()?.getItem(TOKEN_KEY) ?? null,
  setToken: (token) => {
    transientAccessToken = token;
    browserStorage()?.removeItem(TOKEN_KEY);
  },
  clear: () => {
    transientAccessToken = null;
    browserStorage()?.removeItem(TOKEN_KEY);
    browserStorage()?.removeItem(ORGANIZATION_KEY);
    browserStorage()?.removeItem('boletera_org_id');
  },
  getOrganizationId: () =>
    browserStorage()?.getItem(ORGANIZATION_KEY) ??
    browserStorage()?.getItem('boletera_org_id') ??
    null,
  setOrganizationId: (organizationId) =>
    browserStorage()?.setItem(ORGANIZATION_KEY, organizationId),
};

let activeTokenStorage: TokenStorage = cookieTokenStorage;

export function getTokenStorage(): TokenStorage {
  return activeTokenStorage;
}

export function configureTokenStorage(storage: TokenStorage): void {
  activeTokenStorage = storage;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary =
    typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function decodeSessionToken(token: string): SessionSnapshot | null {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as JwtPayload;
    const organizationId =
      stringValue(payload.organizationId) ??
      stringValue(payload.organization_id) ??
      stringValue(payload.orgId) ??
      activeTokenStorage.getOrganizationId();
    const expiresAt =
      typeof payload.exp === 'number' && Number.isFinite(payload.exp)
        ? payload.exp * 1000
        : null;
    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions.filter(
          (permission): permission is string => typeof permission === 'string',
        )
      : [];

    return {
      token,
      expiresAt,
      expired: expiresAt !== null && expiresAt <= Date.now(),
      user: {
        id: stringValue(payload.sub) ?? stringValue(payload.id),
        email: stringValue(payload.email) ?? '',
        organizationId,
        role: stringValue(payload.role) ?? 'USER',
        permissions,
      },
    };
  } catch {
    return null;
  }
}

export function readSession(): SessionSnapshot | null {
  const token = activeTokenStorage.getToken();
  if (!token) return null;
  const session = decodeSessionToken(token);
  if (!session || session.expired) {
    activeTokenStorage.clear();
    return null;
  }
  if (session.user.organizationId) {
    activeTokenStorage.setOrganizationId(session.user.organizationId);
  }
  return session;
}

export function clearSession(): void {
  activeTokenStorage.clear();
}
