import type { SeatMapData, SeatMapLevel } from '@boletera/shared';
import { migrateToV3 } from './migrate';

/**
 * Remove a venue level and clear references from sections / aisles / exits / stairs.
 * Reindexes remaining levels' zIndex by elevation order.
 */
export function removeVenueLevel(input: SeatMapData, levelId: string): SeatMapData {
  const map = migrateToV3(input);
  const levels = (map.venue?.levels ?? []).filter((l) => l.id !== levelId);
  const reindexed = [...levels]
    .sort((a, b) => a.elevation - b.elevation || a.zIndex - b.zIndex)
    .map((l, i) => ({ ...l, zIndex: i }));

  return {
    ...map,
    version: 3,
    sections: map.sections.map((s) => (s.levelId === levelId ? { ...s, levelId: undefined } : s)),
    venue: {
      ...(map.venue ?? {}),
      levels: reindexed.length ? reindexed : undefined,
      aisles: (map.venue?.aisles ?? []).map((a) =>
        a.levelId === levelId ? { ...a, levelId: undefined } : a
      ),
      exits: (map.venue?.exits ?? []).map((e) =>
        e.levelId === levelId ? { ...e, levelId: undefined } : e
      ),
      obstacles: (map.venue?.obstacles ?? []).map((o) =>
        o.levelId === levelId ? { ...o, levelId: undefined } : o
      ),
      furniture: (map.venue?.furniture ?? []).map((f) =>
        f.levelId === levelId ? { ...f, levelId: undefined } : f
      ),
      focusPoints: (map.venue?.focusPoints ?? []).map((f) =>
        f.levelId === levelId ? { ...f, levelId: undefined } : f
      ),
      stairs: (map.venue?.stairs ?? []).map((st) => ({
        ...st,
        fromLevelId: st.fromLevelId === levelId ? undefined : st.fromLevelId,
        toLevelId: st.toLevelId === levelId ? undefined : st.toLevelId,
      })),
    },
  };
}

/** Patch name / elevation / zIndex on an existing level (keeps id). */
export function patchVenueLevel(
  input: SeatMapData,
  levelId: string,
  patch: Partial<Pick<SeatMapLevel, 'name' | 'elevation' | 'zIndex'>>
): SeatMapData {
  const map = migrateToV3(input);
  const levels = map.venue?.levels ?? [];
  if (!levels.some((l) => l.id === levelId)) return map;

  const nextLevels = levels.map((l) => {
    if (l.id !== levelId) return l;
    return {
      ...l,
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.elevation != null && Number.isFinite(patch.elevation)
        ? { elevation: patch.elevation }
        : {}),
      ...(patch.zIndex != null && Number.isFinite(patch.zIndex) ? { zIndex: patch.zIndex } : {}),
    };
  });

  return {
    ...map,
    version: 3,
    venue: {
      ...(map.venue ?? {}),
      levels: nextLevels,
    },
  };
}
