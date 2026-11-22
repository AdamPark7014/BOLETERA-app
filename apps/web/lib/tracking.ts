'use client';

import { useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';
const COOKIE = 'bt_ref';
const STORAGE_KEY = 'boletera.affiliateRef';
const COOKIE_DAYS = 7;

type StoredRef = {
  ref: string;
  eventId?: string;
  capturedAt: string;
};

function normalizeRef(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  return normalized.length ? normalized : undefined;
}

function setCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Guarda el ref en cookie (7 días) y en sessionStorage para el checkout existente. */
export function persistTrackingRef(ref: string, eventId?: string) {
  const normalized = normalizeRef(ref);
  if (!normalized || typeof window === 'undefined') return;
  setCookie(COOKIE, normalized, COOKIE_DAYS);
  const payload: StoredRef = {
    ref: normalized,
    eventId,
    capturedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage bloqueado: la cookie basta para rehidratar
  }
}

export function readTrackingRef(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredRef;
      if (parsed?.ref) return normalizeRef(parsed.ref);
    }
  } catch {
    // ignore
  }
  return normalizeRef(readCookie(COOKIE));
}

function eventSlugFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/events\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

async function postJson(path: string, body: Record<string, string>) {
  try {
    await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // telemetría best-effort
  }
}

/**
 * Una sola pieza en el layout: captura ?ref=, cookie 7 días,
 * visita a la ficha y clic del enlace de seguimiento.
 */
export function TrackingBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const refFromUrl = normalizeRef(params.get('ref'));
    const slug = eventSlugFromPath(window.location.pathname);

    // Rehidratar sessionStorage desde cookie si hace falta
    const cookieRef = normalizeRef(readCookie(COOKIE));
    if (!refFromUrl && cookieRef) {
      try {
        if (!sessionStorage.getItem(STORAGE_KEY)) {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              ref: cookieRef,
              capturedAt: new Date().toISOString(),
            } satisfies StoredRef)
          );
        }
      } catch {
        // ignore
      }
    }

    if (refFromUrl) {
      persistTrackingRef(refFromUrl);
    }

    const ref = refFromUrl ?? cookieRef;
    if (!slug) return;

    void postJson('/metrics/visit', { slug });
    if (ref) {
      void postJson('/tracking-links/click', { slug, code: ref });
    }
  }, []);

  return null;
}
