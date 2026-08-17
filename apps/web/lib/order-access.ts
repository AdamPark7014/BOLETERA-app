import { authHeaders, getToken } from './auth';

/**
 * Credencial del comprador invitado sobre su propia orden.
 *
 * Sin `'use client'` a propósito: la cáscara de servidor de `/orders/[publicId]`
 * importa el nombre del parámetro de la URL, y en un módulo marcado como
 * cliente ese import se convertiría en una referencia opaca.
 *
 * `publicId` dejó de ser credencial: `GET /orders/:publicId`, `/qrcodes` y
 * `/tickets.pdf` devuelven 403 si no llega ni JWT ni `accessToken`. El API
 * entrega ese token UNA SOLA VEZ, en la respuesta de creación, y lo guarda
 * hasheado. Si se pierde, no hay forma de recuperarlo desde el cliente.
 *
 * Por eso lo persistimos en dos sitios con propósitos distintos:
 *
 *   · `localStorage`, por orden → el mismo navegador vuelve a la orden sin
 *     arrastrar el token en la URL (historial, `Referer`, capturas).
 *   · el querystring `?t=` de `/orders/{publicId}` → el correo de confirmación
 *     lleva ese enlace y el comprador puede abrirlo en otro dispositivo.
 *
 * Al abrir un enlace con `?t=` lo archivamos en `localStorage`, de modo que las
 * visitas siguientes desde ese dispositivo ya no dependan del correo.
 */

/** Parámetro en NUESTRAS urls. El API lo espera como `accessToken`. */
export const ORDER_TOKEN_PARAM = 't';

/** Parámetro que entiende el API en `?accessToken=…`. */
export const API_ORDER_TOKEN_PARAM = 'accessToken';

const STORAGE_PREFIX = 'boletera_order_token:';

function storageKey(publicId: string) {
  return `${STORAGE_PREFIX}${publicId}`;
}

export function saveOrderAccessToken(publicId: string, token: string | null | undefined): void {
  if (typeof window === 'undefined' || !publicId || !token) return;
  try {
    window.localStorage.setItem(storageKey(publicId), token);
  } catch {
    /* almacenamiento bloqueado: seguimos con el token en la URL */
  }
}

export function readStoredOrderAccessToken(publicId: string): string | null {
  if (typeof window === 'undefined' || !publicId) return null;
  try {
    return window.localStorage.getItem(storageKey(publicId));
  } catch {
    return null;
  }
}

export function forgetOrderAccessToken(publicId: string): void {
  if (typeof window === 'undefined' || !publicId) return;
  try {
    window.localStorage.removeItem(storageKey(publicId));
  } catch {
    /* nada que hacer */
  }
}

/**
 * Token efectivo para esta orden: primero el del enlace (puede ser un
 * dispositivo nuevo), luego el archivado. El del enlace se archiva de paso.
 */
export function resolveOrderAccessToken(
  publicId: string,
  urlToken?: string | null,
): string | null {
  const fromUrl = urlToken?.trim();
  if (fromUrl) {
    saveOrderAccessToken(publicId, fromUrl);
    return fromUrl;
  }
  return readStoredOrderAccessToken(publicId);
}

/** ¿Hay ALGO con lo que autenticarse? Token de invitado o sesión iniciada. */
export function hasOrderCredential(token: string | null | undefined): boolean {
  return Boolean(token?.trim()) || Boolean(getToken());
}

/** Ruta interna a la orden conservando la credencial del invitado. */
export function orderPath(
  publicId: string,
  token?: string | null,
  suffix = '',
  extraParams?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  // El token va al final para que se lea antes el resto de la URL en el correo.
  if (token?.trim()) params.set(ORDER_TOKEN_PARAM, token.trim());
  const query = params.toString();
  return `/orders/${publicId}${suffix}${query ? `?${query}` : ''}`;
}

/**
 * URL del API para un recurso de la orden con la credencial en el querystring.
 * `tickets.pdf` se descarga con `<a href>`, así que ahí no hay headers: el
 * token TIENE que viajar en la URL.
 */
export function orderApiUrl(
  apiBase: string,
  publicId: string,
  suffix = '',
  token?: string | null,
): string {
  const url = `${apiBase}/orders/${publicId}${suffix}`;
  const trimmed = token?.trim();
  return trimmed ? `${url}?${API_ORDER_TOKEN_PARAM}=${encodeURIComponent(trimmed)}` : url;
}

export type OrderFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; forbidden: boolean; notFound: boolean; message: string };

/**
 * Lectura autenticada de un recurso de la orden. Manda el token si lo hay y
 * SIEMPRE el JWT si existe: un comprador con sesión iniciada que abre el enlace
 * de otro correo suyo debe seguir entrando aunque el token ya no esté.
 */
export async function fetchOrderResource<T>(
  apiBase: string,
  publicId: string,
  suffix: string,
  token: string | null | undefined,
  init?: RequestInit,
): Promise<OrderFetchResult<T>> {
  try {
    const res = await fetch(orderApiUrl(apiBase, publicId, suffix, token), {
      ...init,
      headers: { ...authHeaders(), ...init?.headers },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
      const message = Array.isArray(body.message)
        ? body.message.join('. ')
        : body.message || 'No se pudo leer la orden';
      return {
        ok: false,
        status: res.status,
        forbidden: res.status === 401 || res.status === 403,
        notFound: res.status === 404,
        message,
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      notFound: false,
      message: 'No pudimos conectar con el servidor. Revisa tu conexión.',
    };
  }
}
