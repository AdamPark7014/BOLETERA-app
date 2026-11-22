const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

/**
 * En el servidor (SSR) el API puede vivir en otra dirección que la que ve el
 * navegador: dentro de Docker `localhost:4000` es el propio contenedor web.
 * API_INTERNAL_URL (p. ej. http://api:4000/api/v1) solo se lee en el servidor;
 * sin ella todo sigue igual que antes.
 */
export const API_BASE =
  typeof window === 'undefined' ? process.env.API_INTERNAL_URL || PUBLIC_API : PUBLIC_API;

/**
 * Host del visitante para que el API resuelva el tenant correcto.
 * En el navegador no se puede sobrescribir `Host` (forbidden header), así que
 * mandamos `x-tenant-host` / `x-forwarded-host`. En SSR también reenviamos `host`.
 */
export async function getTenantHostHeaders(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') {
    const host = window.location.host;
    return {
      'x-tenant-host': host,
      'x-forwarded-host': host,
    };
  }

  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const host =
      h.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      h.get('x-tenant-host')?.split(',')[0]?.trim() ||
      h.get('host') ||
      undefined;
    if (!host) return {};
    return {
      host,
      'x-forwarded-host': host,
      'x-tenant-host': host,
    };
  } catch {
    return {};
  }
}

/** Sync helper for client-side raw `fetch` calls (discovery, suggest, etc.). */
export function clientTenantHostHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const host = window.location.host;
  return {
    'x-tenant-host': host,
    'x-forwarded-host': host,
  };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const tenantHeaders = await getTenantHostHeaders();
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...tenantHeaders,
        ...init?.headers,
      },
      cache: 'no-store',
    });
    if (res.status === 503) {
      const ra = Number(res.headers.get('retry-after') || '2');
      const waitMs = Math.max(500, (Number.isFinite(ra) ? ra : 2) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<T>;
  }
  throw new Error('El servidor está saturado. Intenta de nuevo en unos segundos.');
}
