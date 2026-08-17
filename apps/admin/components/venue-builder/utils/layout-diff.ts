import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';

export type SectionDiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export type SectionDiffRow = {
  id: string;
  name: string;
  kind: SectionDiffKind;
  seatsBefore: number;
  seatsAfter: number;
};

export type LayoutDiffSummary = {
  sectionsAdded: number;
  sectionsRemoved: number;
  sectionsChanged: number;
  sectionsUnchanged: number;
  seatsAdded: number;
  seatsRemoved: number;
  seatsMoved: number;
  seatsUnchanged: number;
  capacityBefore: number;
  capacityAfter: number;
  sectionDetails: SectionDiffRow[];
};

const MOVE_EPS = 0.5;

function seatCount(sections: readonly SeatMapSection[]): number {
  return sections.reduce((sum, section) => sum + section.seats.length, 0);
}

function sectionKey(section: SeatMapSection): string {
  return section.id || section.slug || section.name;
}

function seatFingerprint(seat: SeatMapSeat): string {
  return `${seat.x.toFixed(2)}:${seat.y.toFixed(2)}:${seat.label}:${seat.row ?? ''}:${seat.tier ?? ''}`;
}

function seatsMovedOrChanged(
  before: readonly SeatMapSeat[],
  after: readonly SeatMapSeat[],
): { moved: number; unchanged: number; added: number; removed: number } {
  const beforeById = new Map(before.map((seat) => [seat.id, seat]));
  const afterById = new Map(after.map((seat) => [seat.id, seat]));

  let moved = 0;
  let unchanged = 0;
  let added = 0;
  let removed = 0;

  for (const [id, next] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) {
      added += 1;
      continue;
    }
    const dx = Math.abs(prev.x - next.x);
    const dy = Math.abs(prev.y - next.y);
    if (dx > MOVE_EPS || dy > MOVE_EPS || seatFingerprint(prev) !== seatFingerprint(next)) {
      moved += 1;
    } else {
      unchanged += 1;
    }
  }

  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed += 1;
  }

  return { moved, unchanged, added, removed };
}

function sectionChanged(before: SeatMapSection, after: SeatMapSection): boolean {
  if (before.name !== after.name || before.color !== after.color || before.slug !== after.slug) {
    return true;
  }
  if (before.seats.length !== after.seats.length) return true;
  const seatDiff = seatsMovedOrChanged(before.seats, after.seats);
  return seatDiff.added > 0 || seatDiff.removed > 0 || seatDiff.moved > 0;
}

/** Structural diff between the live scene and an AI proposal (sections + seats). */
export function diffLayouts(current: SeatMapData, proposed: SeatMapData): LayoutDiffSummary {
  const beforeSections = current.sections ?? [];
  const afterSections = proposed.sections ?? [];

  const beforeByKey = new Map(beforeSections.map((section) => [sectionKey(section), section]));
  const afterByKey = new Map(afterSections.map((section) => [sectionKey(section), section]));

  const details: SectionDiffRow[] = [];
  let sectionsAdded = 0;
  let sectionsRemoved = 0;
  let sectionsChanged = 0;
  let sectionsUnchanged = 0;
  let seatsAdded = 0;
  let seatsRemoved = 0;
  let seatsMoved = 0;
  let seatsUnchanged = 0;

  for (const [key, after] of afterByKey) {
    const before = beforeByKey.get(key);
    if (!before) {
      sectionsAdded += 1;
      seatsAdded += after.seats.length;
      details.push({
        id: after.id,
        name: after.name,
        kind: 'added',
        seatsBefore: 0,
        seatsAfter: after.seats.length,
      });
      continue;
    }
    const seatDiff = seatsMovedOrChanged(before.seats, after.seats);
    seatsAdded += seatDiff.added;
    seatsRemoved += seatDiff.removed;
    seatsMoved += seatDiff.moved;
    seatsUnchanged += seatDiff.unchanged;
    const kind: SectionDiffKind = sectionChanged(before, after) ? 'changed' : 'unchanged';
    if (kind === 'changed') sectionsChanged += 1;
    else sectionsUnchanged += 1;
    details.push({
      id: after.id,
      name: after.name,
      kind,
      seatsBefore: before.seats.length,
      seatsAfter: after.seats.length,
    });
  }

  for (const [key, before] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    sectionsRemoved += 1;
    seatsRemoved += before.seats.length;
    details.push({
      id: before.id,
      name: before.name,
      kind: 'removed',
      seatsBefore: before.seats.length,
      seatsAfter: 0,
    });
  }

  details.sort((a, b) => {
    const order: Record<SectionDiffKind, number> = {
      added: 0,
      removed: 1,
      changed: 2,
      unchanged: 3,
    };
    return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name);
  });

  return {
    sectionsAdded,
    sectionsRemoved,
    sectionsChanged,
    sectionsUnchanged,
    seatsAdded,
    seatsRemoved,
    seatsMoved,
    seatsUnchanged,
    capacityBefore: seatCount(beforeSections),
    capacityAfter: seatCount(afterSections),
    sectionDetails: details,
  };
}

/** True when the proposal has nothing useful to apply. */
export function isEmptyProposal(map: SeatMapData): boolean {
  return (map.sections?.length ?? 0) === 0;
}
