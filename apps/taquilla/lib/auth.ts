const TOKEN_KEY = 'taquilla_token';
const CASHIER_KEY = 'taquilla_cashier';
const ORG_KEY = 'boletera_org';
const USER_KEY = 'taquilla_user';
const TERMINAL_LABEL_KEY = 'taquilla_terminal_label';
const TOKEN_ISSUED_KEY = 'taquilla_token_issued_at';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** El API firma con `JWT_EXPIRATION` = 2 h. Avisamos antes de que caduque. */
export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const TOKEN_WARN_MINUTES = 10;

export type TaquillaUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  organizationId?: string | null;
  organizationName?: string | null;
};

const ORG_NAME_KEY = 'taquilla_org_name';

/** Roles que pueden tocar configuración de organización (PIN de gerente). */
const MANAGER_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER']);

export function getApiBase() {
  return API;
}

export function getTaquillaToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getCashierId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CASHIER_KEY);
}

export function getOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ORG_KEY);
}

export function getOrgName(): string {
  if (typeof window === 'undefined') return 'TAQUILLA';
  return localStorage.getItem(ORG_NAME_KEY) || 'TAQUILLA';
}

export function getTerminalLabel(): string {
  if (typeof window === 'undefined') return 'TAQ-01';
  return localStorage.getItem(TERMINAL_LABEL_KEY) || 'TAQ-01';
}

export function getTaquillaUser(): TaquillaUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TaquillaUser;
  } catch {
    return null;
  }
}

export function isManager(): boolean {
  return MANAGER_ROLES.has(getTaquillaUser()?.role ?? '');
}

/** Milisegundos que le quedan al token, o null si no hay sesión. */
export function tokenTimeLeftMs(): number | null {
  if (typeof window === 'undefined') return null;
  if (!getTaquillaToken()) return null;
  const issued = Number(localStorage.getItem(TOKEN_ISSUED_KEY) || '0');
  if (!issued) return null;
  return Math.max(0, issued + TOKEN_TTL_MS - Date.now());
}

export function tokenExpiringSoon(): boolean {
  const left = tokenTimeLeftMs();
  return left != null && left <= TOKEN_WARN_MINUTES * 60_000;
}

export function saveTaquillaSession(
  token: string,
  opts: {
    terminalLabel: string;
    user: TaquillaUser;
    cashierId?: string;
  },
) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TERMINAL_LABEL_KEY, opts.terminalLabel);
  localStorage.setItem(USER_KEY, JSON.stringify(opts.user));
  localStorage.setItem(CASHIER_KEY, opts.cashierId || opts.user.id);
  localStorage.setItem(TOKEN_ISSUED_KEY, String(Date.now()));
  if (opts.user.organizationId) {
    localStorage.setItem(ORG_KEY, opts.user.organizationId);
  }
  const orgName = opts.user.organizationName?.trim();
  if (orgName) {
    localStorage.setItem(ORG_NAME_KEY, orgName);
  }
}

export function clearTaquillaSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CASHIER_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TERMINAL_LABEL_KEY);
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem(ORG_NAME_KEY);
  localStorage.removeItem(TOKEN_ISSUED_KEY);
  localStorage.removeItem('boletera_pos_session');
  localStorage.removeItem('boletera_terminal_id');
  localStorage.removeItem('boletera_cashier_id');
  localStorage.removeItem('boletera_opening_cash');
  localStorage.removeItem('boletera_last_receipt');
}

// ---------------------------------------------------------------------------
// Reautenticación sin perder la venta (token de 2 h vs. turno de 8 h)
// ---------------------------------------------------------------------------

export type ReauthRequest = {
  email: string;
  /** El diálogo llama a esto con `true` cuando ya guardó un token nuevo. */
  resolve: (ok: boolean) => void;
};

type ReauthListener = (req: ReauthRequest) => void;

const reauthListeners = new Set<ReauthListener>();
let pendingReauth: Promise<boolean> | null = null;

/** El diálogo global de reautenticación se registra aquí (ver ReauthDialog). */
export function onReauthRequired(listener: ReauthListener): () => void {
  reauthListeners.add(listener);
  return () => reauthListeners.delete(listener);
}

/**
 * Pide reautenticación UNA sola vez aunque cuatro peticiones reciban 401 a la
 * vez: si no, el cajero vería cuatro diálogos encima de la misma venta.
 */
export function requestReauth(): Promise<boolean> {
  if (pendingReauth) return pendingReauth;
  if (!reauthListeners.size) return Promise.resolve(false);
  const email = getTaquillaUser()?.email ?? '';
  pendingReauth = new Promise<boolean>((resolve) => {
    const req: ReauthRequest = {
      email,
      resolve: (ok) => {
        pendingReauth = null;
        resolve(ok);
      },
    };
    reauthListeners.forEach((listener) => listener(req));
  });
  return pendingReauth;
}

/**
 * Login contra el API. Devuelve el usuario para que quien llama decida si es
 * el mismo cajero (reautenticación) u otro (traspaso de turno).
 */
export async function loginRequest(email: string, password: string) {
  const res = await rawFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    user?: TaquillaUser;
    message?: string | string[];
  };
  if (!res.ok || !data.accessToken || !data.user) {
    const raw = data.message;
    const msg = Array.isArray(raw)
      ? raw.join(', ')
      : raw === 'Invalid credentials'
        ? 'Correo o contraseña incorrectos'
        : raw;
    throw new Error(msg || 'Credenciales inválidas');
  }
  return { accessToken: data.accessToken, user: data.user };
}

/** Renueva el token del MISMO cajero conservando terminal y turno abiertos. */
export async function reauthenticateSameCashier(email: string, password: string) {
  const { accessToken, user } = await loginRequest(email, password);
  const current = getTaquillaUser();
  if (current && current.id !== user.id) {
    // Cambiar de persona a mitad de un turno rompería la trazabilidad del corte:
    // el relevo se hace por traspaso de turno, no por el diálogo de sesión.
    throw new Error('Ese usuario no es el cajero del turno. Usa traspaso de turno en Corte (F12).');
  }
  saveTaquillaSession(accessToken, {
    terminalLabel: getTerminalLabel(),
    user,
    cashierId: getCashierId() || user.id,
  });
  return user;
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API}${path.startsWith('/') ? path : `/${path}`}`, init).catch((err: unknown) => {
    const msg =
      err instanceof TypeError
        ? `Sin conexión con el API (${API})`
        : err instanceof Error
          ? err.message
          : 'Error de red';
    throw new Error(msg);
  });
}

/**
 * `fetch` con token. Ante un 401 abre el diálogo de reautenticación y REPITE la
 * petición con el token nuevo, para que una venta a medias no se pierda por un
 * token caducado con fila esperando.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: { reauth?: boolean } = {},
): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
    const token = getTaquillaToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return rawFetch(path, { ...init, headers });
  };

  const res = await send();
  if (res.status !== 401) return res;
  if (opts.reauth === false) return res;
  // Sólo se puede reintentar si el cuerpo es reproducible (todas nuestras
  // llamadas mandan JSON serializado; un ReadableStream ya se consumió).
  if (init.body != null && typeof init.body !== 'string') return res;

  const ok = await requestReauth();
  if (!ok) {
    clearTaquillaSession();
    throw new ApiError(401, 'Sesión caducada. Vuelve a iniciar sesión.');
  }
  return send();
}

/** `apiFetch` + parseo JSON + error tipado. */
export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  opts: { reauth?: boolean } = {},
): Promise<T> {
  const res = await apiFetch(path, init, opts);
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : typeof body === 'string' && body
          ? body
          : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
