import { clearSession, getTokenStorage } from './session';
import { addCsrfHeader } from './auth-cookies';

const API_URL =
  process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type BackendErrorBody = {
  message?: unknown;
  error?: unknown;
  details?: unknown;
};

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class AuthenticationError extends HttpError {
  constructor(message = 'Tu sesión expiró. Inicia sesión nuevamente.', details?: unknown) {
    super(message, 401, 'UNAUTHENTICATED', details);
    this.name = 'AuthenticationError';
  }
}

export class PermissionError extends HttpError {
  constructor(message = 'No tienes permisos para realizar esta acción.', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
    this.name = 'PermissionError';
  }
}

export class ServerError extends HttpError {
  constructor(status: number, message = 'El servidor no pudo completar la solicitud.', details?: unknown) {
    super(message, status, 'SERVER_ERROR', details);
    this.name = 'ServerError';
  }
}

export class NetworkError extends HttpError {
  constructor(message = 'No se pudo conectar con el servidor. Revisa tu conexión.') {
    super(message, null, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class RequestAbortedError extends HttpError {
  constructor() {
    super('La solicitud fue cancelada.', null, 'ABORTED');
    this.name = 'RequestAbortedError';
  }
}

export type HttpOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | readonly unknown[] | null;
  responseType?: 'json' | 'text' | 'blob';
  auth?: boolean;
  /** Solo para mantener compatibilidad con las APIs antiguas `fn(token, ...)`. */
  token?: string;
};

function messageFromBody(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const candidate = body as BackendErrorBody;
    if (Array.isArray(candidate.message)) {
      const messages = candidate.message.filter(
        (item): item is string => typeof item === 'string',
      );
      if (messages.length) return messages.join('. ');
    }
    if (typeof candidate.message === 'string') return candidate.message;
    if (typeof candidate.error === 'string') return candidate.error;
  }
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'La operación entra en conflicto con el estado actual.';
  if (status === 422 || status === 400) return 'Revisa los datos enviados e intenta de nuevo.';
  return `La solicitud falló (${status}).`;
}

async function errorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  try {
    return contentType.includes('json') ? await response.json() : await response.text();
  } catch {
    return null;
  }
}

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/login')) return;
  window.location.replace('/login');
}

function requestBody(
  body: HttpOptions['body'],
  headers: Headers,
): BodyInit | null | undefined {
  if (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(body);
}

function isStateChanging(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
    (method ?? 'GET').toUpperCase(),
  );
}

function responseValue<T>(
  response: Response,
  responseType: HttpOptions['responseType'],
): Promise<T> {
  if (response.status === 204) return Promise.resolve(undefined as T);
  if (responseType === 'text') return response.text() as Promise<T>;
  if (responseType === 'blob') return response.blob() as Promise<T>;
  return response.json() as Promise<T>;
}

type RefreshResult = {
  accessToken?: unknown;
};

let refreshPromise: Promise<void> | null = null;
let authGeneration = 0;

async function performRefresh(): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  addCsrfHeader(headers);
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const details = await errorBody(response);
    throw new AuthenticationError(
      messageFromBody(details, response.status),
      details,
    );
  }

  const result = (await response.json()) as RefreshResult;
  if (typeof result.accessToken === 'string' && result.accessToken) {
    getTokenStorage().setToken(result.accessToken);
  }
  authGeneration += 1;
}

export function refreshAuthentication(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function executeRequest<T>(
  path: string,
  options: HttpOptions,
  retried: boolean,
  requestGeneration: number,
): Promise<T> {
  const {
    body,
    responseType = 'json',
    auth = true,
    token: explicitToken,
    headers: initialHeaders,
    ...init
  } = options;
  const headers = new Headers(initialHeaders);
  const token = explicitToken ?? getTokenStorage().getToken();
  if (auth && token) headers.set('Authorization', `Bearer ${token}`);
  if (auth && isStateChanging(init.method)) addCsrfHeader(headers);

  const response = await fetch(path.startsWith('http') ? path : `${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
    body: requestBody(body, headers),
  });

  if (!response.ok) {
    if (response.status === 401 && auth && !retried) {
      try {
        if (authGeneration === requestGeneration) {
          await refreshAuthentication();
        }
        return executeRequest<T>(path, options, true, authGeneration);
      } catch (refreshError) {
        clearSession();
        redirectToLogin();
        throw refreshError;
      }
    }

    const details = await errorBody(response);
    const message = messageFromBody(details, response.status);
    if (response.status === 401) {
      clearSession();
      redirectToLogin();
      throw new AuthenticationError(message, details);
    }
    if (response.status === 403) throw new PermissionError(message, details);
    if (response.status >= 500) {
      throw new ServerError(response.status, message, details);
    }
    throw new HttpError(message, response.status, 'REQUEST_FAILED', details);
  }

  return responseValue<T>(response, responseType);
}

export async function http<T>(path: string, options: HttpOptions = {}): Promise<T> {
  try {
    return await executeRequest<T>(path, options, false, authGeneration);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RequestAbortedError();
    }
    throw new NetworkError(error instanceof Error ? error.message : undefined);
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await http('/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}

export async function revokeAllSessions(): Promise<void> {
  try {
    await http('/auth/sessions/revoke-all', { method: 'POST' });
  } finally {
    clearSession();
  }
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true;
  return error.status === null || error.status >= 500;
}
