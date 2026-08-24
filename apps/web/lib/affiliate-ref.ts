const STORAGE_KEY = 'boletera.affiliateRef';

type StoredRef = {
  ref: string;
  eventId?: string;
  capturedAt: string;
};

function readStore(): StoredRef | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRef;
    if (!parsed?.ref || typeof parsed.ref !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Normalizes affiliate ref codes from `?ref=` query params. */
export function normalizeAffiliateRef(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toUpperCase().slice(0, 64);
  return normalized.length ? normalized : undefined;
}

/** Persists ref from the landing URL so checkout can attach it to the order. */
export function captureAffiliateRef(ref: string | undefined, eventId?: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeAffiliateRef(ref);
  if (!normalized) return;
  const payload: StoredRef = {
    ref: normalized,
    eventId,
    capturedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage full or blocked — checkout may still read ?ref= from URL
  }
}

/** Returns the stored ref when it matches the event (or when no event scope was set). */
export function getAffiliateRefForEvent(eventId?: string): string | undefined {
  const stored = readStore();
  if (!stored) return undefined;
  if (stored.eventId && eventId && stored.eventId !== eventId) return undefined;
  return stored.ref;
}

export function clearAffiliateRef() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
