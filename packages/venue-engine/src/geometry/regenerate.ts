import type { SeatMapBlock, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import { generateBlock } from './generators';
import { migrateToV3 } from './migrate';

export type RegenerateBlocksOptions = {
  /** Only regenerate this section id; default = all sections with blocks */
  sectionId?: string;
  /** Merge section-level rake/pitch/curvature into each block before generate */
  inheritSectionParams?: boolean;
};

function seatsFromBlocks(sec: SeatMapSection, inherit: boolean): SeatMapSeat[] {
  if (!sec.blocks?.length) return sec.seats;
  return sec.blocks.flatMap((block, bi) => {
    const merged: SeatMapBlock = inherit
      ? {
          ...block,
          rake: block.rake ?? sec.rake,
          seatPitch: block.seatPitch || sec.seatPitch || 26,
          rowPitch: block.rowPitch || sec.rowPitch || 28,
          curvature: block.curvature ?? sec.curvature,
        }
      : block;
    return generateBlock({
      ...merged,
      idPrefix: `${sec.slug || sec.id}-b${bi}`,
    }).map((seat, i) => ({
      ...seat,
      id: `${sec.id}-regen-${bi}-${i}-${seat.label}`,
      levelId: seat.levelId ?? sec.levelId,
    }));
  });
}

/**
 * Rebuild seats from authored `section.blocks`.
 * Sections without blocks are left unchanged (e.g. hand-drawn GA / curved arena).
 */
export function regenerateSeatsFromBlocks(
  input: SeatMapData | null | undefined,
  opts?: RegenerateBlocksOptions
): SeatMapData {
  const map = migrateToV3(input ?? { sections: [], version: 3 });
  const inherit = opts?.inheritSectionParams !== false;
  const targetId = opts?.sectionId;

  const sections = map.sections.map((sec) => {
    if (targetId && sec.id !== targetId) return sec;
    if (!sec.blocks?.length) return sec;
    return {
      ...sec,
      seats: seatsFromBlocks(sec, inherit),
    };
  });

  return { ...map, version: 3, sections };
}

export function sectionHasBlocks(sec: SeatMapSection): boolean {
  return Boolean(sec.blocks?.length);
}
