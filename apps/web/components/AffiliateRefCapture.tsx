'use client';

import { useEffect } from 'react';
import { captureAffiliateRef } from '@/lib/affiliate-ref';

/** Reads `?ref=` on event pages and stores it for checkout attribution. */
export function AffiliateRefCapture({
  refCode,
  eventId,
}: {
  refCode?: string | null;
  eventId: string;
}) {
  useEffect(() => {
    captureAffiliateRef(refCode ?? undefined, eventId);
  }, [refCode, eventId]);

  return null;
}
