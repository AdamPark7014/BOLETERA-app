'use client';

import { useMemo } from 'react';
import type { SeatMapData } from '@boletera/shared';
import {
  applySightlinesToScene,
  calculateSightlines,
  resolveGeometry,
  type SightlineResult,
  type SightlineScore,
} from '@boletera/venue-engine';

export function useSightlineAnalysis(
  map: SeatMapData | null,
  levelId: string | 'ALL',
): {
  result: SightlineResult | null;
  bySeat: Map<string, SightlineScore>;
} {
  return useMemo(() => {
    if (!map) return { result: null, bySeat: new Map() };
    const scene = resolveGeometry(map);
    const options = levelId === 'ALL' ? undefined : { levelId };
    const result = calculateSightlines(scene, options);
    const bySeat = new Map(result.scores.map((score) => [score.seatId, score]));
    return { result, bySeat };
  }, [map, levelId]);
}

/** Aplica visibilidad calculada al mapa (copia) para persistencia opcional. */
export function applySightlinesToMap(map: SeatMapData, levelId?: string): SeatMapData {
  const scene = resolveGeometry(map);
  const { scene: next } = applySightlinesToScene(scene, levelId ? { levelId } : undefined);
  const visibilityById = new Map(next.seats.map((s) => [s.id, s.visibility]));
  return {
    ...map,
    sections: map.sections.map((section) => ({
      ...section,
      seats: section.seats.map((seat) => {
        const visibility = visibilityById.get(seat.id);
        return visibility ? { ...seat, visibility } : seat;
      }),
    })),
  };
}
