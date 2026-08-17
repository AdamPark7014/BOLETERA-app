import type { SeatMapData, SeatMapSection, SeatMapVenueMeta } from '@boletera/shared';

/**
 * `onAiSuggest` may return a full map or just sections.
 * Normalize to SeatMapData, preserving venue meta from the live scene when needed.
 */
export function normalizeAiSuggestResult(
  result: SeatMapData | SeatMapSection[],
  venueFallback?: SeatMapVenueMeta,
): SeatMapData {
  if (Array.isArray(result)) {
    return {
      version: 3,
      sections: result,
      venue: venueFallback,
    };
  }
  return {
    ...result,
    version: result.version ?? 3,
    sections: result.sections ?? [],
    venue: result.venue ?? venueFallback,
  };
}
