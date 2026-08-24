/** Normalizes `?ref=` / affiliate codes from checkout (uppercase, trimmed, max 64). */
export function normalizeAffiliateRef(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toUpperCase().slice(0, 64);
  return normalized.length ? normalized : undefined;
}

type EventMetadata = {
  channels?: {
    affiliate?: {
      enabled?: boolean;
      partners?: string[];
    };
  };
};

/** Partner codes configured on the event (`metadata.channels.affiliate.partners`). */
export function eventAffiliatePartners(metadata: unknown): string[] {
  const meta = (metadata ?? {}) as EventMetadata;
  const partners = meta.channels?.affiliate?.partners;
  if (!Array.isArray(partners)) return [];
  return partners
    .map((p) => (typeof p === 'string' ? normalizeAffiliateRef(p) : undefined))
    .filter((p): p is string => Boolean(p));
}

/** True when the ref matches a configured partner, or when no partners are configured. */
export function isKnownAffiliateRef(metadata: unknown, ref: string): boolean {
  const partners = eventAffiliatePartners(metadata);
  if (!partners.length) return true;
  return partners.includes(ref);
}
