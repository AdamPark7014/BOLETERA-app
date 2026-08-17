const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';

export type AuthUser = {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
};

/** Claves de almacenamiento — centralizadas para que login y OAuth no diverjan. */
export const STORAGE_KEYS = {
  token: 'boletera_token',
  org: 'boletera_org',
  role: 'boletera_role',
} as const;

/**
 * Error de API con el estado HTTP intacto.
 *
 * `adminApi` lanzaba `new Error(await res.text())`, así que ningún llamador podía
 * distinguir "token vencido" (401) de "no perteneces a esta organización" (403)
 * de un 500. Con el JWT de 2 h y el `OrgAccessGuard` endurecido, esa distinción
 * es justo la que necesita la interfaz.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly path: string;

  constructor(status: number, message: string, body: unknown, path: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }

  /** Sesión vencida o revocada: hay que reautenticar. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Autenticado, pero sin permiso sobre el recurso u organización. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** 403 concreto del `OrgAccessGuard`. */
  get isOrgDenied(): boolean {
    return this.status === 403 && /organization access denied/i.test(this.message);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Mensaje presentable en español para la interfaz. */
  get userMessage(): string {
    if (this.isUnauthorized) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    if (this.isOrgDenied) return 'No tienes acceso a esta organización.';
    if (this.isForbidden) return 'Tu rol no permite esta acción.';
    if (this.isNotFound) return 'No se encontró el recurso solicitado.';
    if (this.status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo.';
    return this.message || 'No se pudo completar la operación.';
  }
}

/** Evento global de sesión inválida — lo escucha el `SessionProvider`. */
export const SESSION_EXPIRED_EVENT = 'boletera:session-expired';
export const ORG_DENIED_EVENT = 'boletera:org-denied';

/**
 * Reautenticación transparente.
 *
 * El `SessionProvider` registra aquí un resolvedor que abre el diálogo y
 * devuelve el token nuevo (o `null` si el usuario se rinde y sale). Con eso,
 * una petición que recibe 401 no se pierde: espera a que el operador vuelva a
 * entrar y se reintenta sola. Sin esto, con un JWT de 2 h que además se revoca
 * al cambiar el usuario, cada expiración tiraba a la basura la acción en curso
 * (un alta a medio guardar, un reporte a medio cargar).
 */
export type ReauthResolver = () => Promise<string | null>;

let reauthResolver: ReauthResolver | null = null;
/** Reautenticación en vuelo: 8 peticiones fallando a la vez abren un solo diálogo. */
let pendingReauth: Promise<string | null> | null = null;

export function registerReauthResolver(fn: ReauthResolver): () => void {
  reauthResolver = fn;
  return () => {
    if (reauthResolver === fn) reauthResolver = null;
  };
}

async function requestFreshToken(): Promise<string | null> {
  if (!reauthResolver) return null;
  if (!pendingReauth) {
    pendingReauth = reauthResolver().finally(() => {
      pendingReauth = null;
    });
  }
  return pendingReauth;
}

function notifySessionExpired(path: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { path } }));
}

function notifyOrgDenied(path: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ORG_DENIED_EVENT, { detail: { path } }));
}

/** Extrae el mensaje útil de una respuesta de error de Nest. */
async function readError(res: Response): Promise<{ message: string; body: unknown }> {
  const raw = await res.text();
  if (!raw) return { message: res.statusText || `HTTP ${res.status}`, body: null };
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
    const msg = Array.isArray(parsed.message)
      ? parsed.message.join(', ')
      : typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : raw;
    return { message: msg, body: parsed };
  } catch {
    return { message: raw, body: raw };
  }
}

export type AdminApiOptions = RequestInit & {
  /** No emitir el evento global de sesión vencida (para sondeos de fondo). */
  silent?: boolean;
  /**
   * No reintentar tras reautenticar. Úsalo solo en sondeos periódicos: si el
   * usuario no está delante, no tiene sentido dejar la petición esperando.
   */
  noRetry?: boolean;
};

export async function adminApi<T>(
  path: string,
  token: string,
  init?: AdminApiOptions,
): Promise<T> {
  const { silent, noRetry, ...rest } = init ?? {};

  async function send(bearer: string): Promise<Response> {
    return fetch(`${API}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
        ...init?.headers,
      },
    });
  }

  let res = await send(token);

  // 401: se pide reautenticar y se reintenta UNA vez con el token nuevo. El
  // llamador ni se entera; su `await` simplemente tarda lo que tarde el diálogo.
  if (res.status === 401 && !silent && !noRetry) {
    notifySessionExpired(path);
    const fresh = await requestFreshToken();
    if (fresh) res = await send(fresh);
  }

  if (!res.ok) {
    const { message, body } = await readError(res);
    const error = new ApiError(res.status, message, body, path);
    if (!silent) {
      // El 401 ya se notificó antes de reintentar; no se duplica el aviso.
      if (error.isUnauthorized && (noRetry || !reauthResolver)) notifySessionExpired(path);
      else if (error.isOrgDenied) notifyOrgDenied(path);
    }
    throw error;
  }

  // 204 y cuerpos vacíos no son JSON válido.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Descarga binaria autenticada con el mismo tratamiento de errores. */
export async function adminDownload(
  path: string,
  token: string,
  fallbackFilename: string,
): Promise<void> {
  let res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Una descarga es cara de repetir a mano: se reautentica y se reintenta igual
  // que en `adminApi` en vez de devolver un archivo vacío.
  if (res.status === 401) {
    notifySessionExpired(path);
    const fresh = await requestFreshToken();
    if (fresh) {
      res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${fresh}` } });
    }
  }
  if (!res.ok) {
    const { message, body } = await readError(res);
    const error = new ApiError(res.status, message, body, path);
    if (error.isOrgDenied) notifyOrgDenied(path);
    throw error;
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const { message, body } = await readError(res);
    // Se conserva el estado real para poder distinguir credenciales de caída del servidor.
    throw new ApiError(res.status, message, body, '/auth/login');
  }
  return res.json() as Promise<{ accessToken: string; user: AuthUser }>;
}

export async function fetchMe(token: string) {
  return adminApi<AuthUser>('/auth/me', token);
}

export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.token);
}

/**
 * Persiste la sesión. Un único punto de escritura evita el desajuste que había
 * entre el login por contraseña (`boletera_org`) y el callback OAuth
 * (`boletera_org_id`, que nadie leía): tras SSO la organización quedaba sin
 * definir y toda pantalla que la exigía recibía 403.
 */
export function storeSession(accessToken: string, user: Pick<AuthUser, 'organizationId' | 'role'>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.token, accessToken);
  if (user.organizationId) localStorage.setItem(STORAGE_KEYS.org, user.organizationId);
  else localStorage.removeItem(STORAGE_KEYS.org);
  if (user.role) localStorage.setItem(STORAGE_KEYS.role, user.role);
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.org);
  localStorage.removeItem(STORAGE_KEYS.role);
}

/** Lee el payload del JWT sin validar firma (solo para pintar la interfaz). */
export function decodeToken(
  token: string,
): { sub?: string; email?: string; role?: string; organizationId?: string; exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** ¿El token ya venció (o vence en menos de `skewSeconds`)? */
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeToken(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

/**
 * Segundos que le quedan al token, o `null` si no declara `exp`.
 * Sirve para avisar antes de que caiga, no para decidir seguridad.
 */
export function secondsUntilExpiry(token: string | null): number | null {
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload?.exp) return null;
  return Math.max(0, Math.round((payload.exp * 1000 - Date.now()) / 1000));
}
