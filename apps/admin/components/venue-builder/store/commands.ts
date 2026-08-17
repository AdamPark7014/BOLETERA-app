import type {
  SeatMapData,
  SeatMapSeat,
  SeatMapSection,
  SeatMapVenueMeta,
} from '@boletera/shared';
import type { SeatPatch } from '@boletera/venue-engine/render';
import type { EditorCommand, SceneMutation } from './types';

let commandSeq = 0;
function nextCommandId(): string {
  commandSeq += 1;
  return `cmd-${commandSeq}`;
}

/** Plan pose of a seat: `rotation` is the 2D yaw in degrees. */
export type SeatPose = { x: number; y: number; rotation: number };

export function poseOf(seat: SeatMapSeat): SeatPose {
  return { x: seat.x, y: seat.y, rotation: seat.rotation ?? 0 };
}

/** Keeps the 3D mirrors (`position` / `coord3d` / `rotation3d`) in sync. */
function seatWithPose(seat: SeatMapSeat, pose: SeatPose): SeatMapSeat {
  const next: SeatMapSeat = { ...seat, x: pose.x, y: pose.y, rotation: pose.rotation };
  if (seat.position) next.position = { ...seat.position, x: pose.x, z: pose.y };
  if (seat.coord3d) next.coord3d = { ...seat.coord3d, x: pose.x, z: pose.y };
  if (seat.rotation3d) next.rotation3d = { ...seat.rotation3d, y: pose.rotation };
  return next;
}

function applyPoses(scene: SeatMapData, poses: Map<string, SeatPose>): SceneMutation {
  const patch: SeatPatch[] = [];
  const sections = scene.sections.map((section) => {
    let touched = false;
    const seats = section.seats.map((seat) => {
      const target = poses.get(seat.id);
      if (!target) return seat;
      touched = true;
      patch.push({ id: seat.id, x: target.x, y: target.y });
      return seatWithPose(seat, target);
    });
    return touched ? { ...section, seats } : section;
  });
  return { scene: { ...scene, sections }, patch };
}

export type SeatPoseEntry = { id: string; before: SeatPose; after: SeatPose };

/**
 * Absolute (not relative) seat posing, so undo/redo stays idempotent even when
 * other commands ran in between. Drags, rotations and scaling all use it.
 */
export function transformSeatsCommand(
  label: string,
  entries: readonly SeatPoseEntry[],
): EditorCommand {
  const forward = new Map(entries.map((e) => [e.id, e.after] as const));
  const backward = new Map(entries.map((e) => [e.id, e.before] as const));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => applyPoses(scene, forward),
    revert: (scene) => applyPoses(scene, backward),
  };
}

export type SeatAttributes = Pick<SeatMapSeat, 'label' | 'row' | 'tier'>;

export type SeatAttributeEntry = {
  id: string;
  before: SeatAttributes;
  after: SeatAttributes;
};

function applyAttributes(
  scene: SeatMapData,
  attributes: Map<string, SeatAttributes>,
): SceneMutation {
  const patch: SeatPatch[] = [];
  const sections = scene.sections.map((section) => {
    let touched = false;
    const seats = section.seats.map((seat) => {
      const attrs = attributes.get(seat.id);
      if (!attrs) return seat;
      touched = true;
      patch.push({ id: seat.id, label: attrs.label, row: attrs.row, tier: attrs.tier });
      return { ...seat, label: attrs.label, row: attrs.row, tier: attrs.tier };
    });
    return touched ? { ...section, seats } : section;
  });
  return { scene: { ...scene, sections }, patch };
}

/** Renumbering, tier assignment and row relabelling all funnel through here. */
export function setSeatAttributesCommand(
  label: string,
  entries: readonly SeatAttributeEntry[],
): EditorCommand {
  const forward = new Map(entries.map((e) => [e.id, e.after] as const));
  const backward = new Map(entries.map((e) => [e.id, e.before] as const));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => applyAttributes(scene, forward),
    revert: (scene) => applyAttributes(scene, backward),
  };
}

export function addSectionsCommand(
  label: string,
  sections: readonly SeatMapSection[],
): EditorCommand {
  const ids = new Set(sections.map((s) => s.id));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => ({ scene: { ...scene, sections: [...scene.sections, ...sections] } }),
    revert: (scene) => ({
      scene: { ...scene, sections: scene.sections.filter((s) => !ids.has(s.id)) },
    }),
  };
}

export function removeSectionsCommand(
  label: string,
  removed: readonly SeatMapSection[],
): EditorCommand {
  const ids = new Set(removed.map((s) => s.id));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => ({
      scene: { ...scene, sections: scene.sections.filter((s) => !ids.has(s.id)) },
    }),
    revert: (scene) => ({ scene: { ...scene, sections: [...scene.sections, ...removed] } }),
  };
}

export type SectionPatch = Partial<Omit<SeatMapSection, 'id' | 'seats'>>;

function applySectionPatch(
  scene: SeatMapData,
  sectionId: string,
  patch: SectionPatch,
): SceneMutation {
  return {
    scene: {
      ...scene,
      sections: scene.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    },
  };
}

export function updateSectionCommand(
  label: string,
  sectionId: string,
  before: SectionPatch,
  after: SectionPatch,
): EditorCommand {
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => applySectionPatch(scene, sectionId, after),
    revert: (scene) => applySectionPatch(scene, sectionId, before),
  };
}

export function addSeatsCommand(
  label: string,
  sectionId: string,
  seats: readonly SeatMapSeat[],
): EditorCommand {
  const ids = new Set(seats.map((s) => s.id));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((s) =>
          s.id === sectionId ? { ...s, seats: [...s.seats, ...seats] } : s,
        ),
      },
    }),
    revert: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((s) =>
          s.id === sectionId ? { ...s, seats: s.seats.filter((seat) => !ids.has(seat.id)) } : s,
        ),
      },
    }),
  };
}

export type SeatBatch = { sectionId: string; seats: SeatMapSeat[] };

/** Insert seats into several sections as one undoable step (duplicate, generate). */
export function addSeatsBatchCommand(label: string, batches: readonly SeatBatch[]): EditorCommand {
  const bySection = new Map(batches.map((b) => [b.sectionId, b.seats] as const));
  const ids = new Set(batches.flatMap((b) => b.seats.map((seat) => seat.id)));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((section) => {
          const seats = bySection.get(section.id);
          return seats ? { ...section, seats: [...section.seats, ...seats] } : section;
        }),
      },
    }),
    revert: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((section) =>
          bySection.has(section.id)
            ? { ...section, seats: section.seats.filter((seat) => !ids.has(seat.id)) }
            : section,
        ),
      },
    }),
  };
}

export type RemovedSeat = { sectionId: string; index: number; seat: SeatMapSeat };

export function removeSeatsCommand(label: string, removed: readonly RemovedSeat[]): EditorCommand {
  const ids = new Set(removed.map((r) => r.seat.id));
  const bySection = new Map<string, RemovedSeat[]>();
  for (const entry of removed) {
    const list = bySection.get(entry.sectionId);
    if (list) list.push(entry);
    else bySection.set(entry.sectionId, [entry]);
  }
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((section) =>
          bySection.has(section.id)
            ? { ...section, seats: section.seats.filter((seat) => !ids.has(seat.id)) }
            : section,
        ),
      },
    }),
    revert: (scene) => ({
      scene: {
        ...scene,
        sections: scene.sections.map((section) => {
          const entries = bySection.get(section.id);
          if (!entries) return section;
          const seats = [...section.seats];
          for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
            seats.splice(Math.min(entry.index, seats.length), 0, entry.seat);
          }
          return { ...section, seats };
        }),
      },
    }),
  };
}

export type SeatOwnership = { seatId: string; sectionId: string };

function applyOwnership(scene: SeatMapData, owners: Map<string, string>): SceneMutation {
  const moved = new Map<string, SeatMapSeat>();
  for (const section of scene.sections) {
    for (const seat of section.seats) {
      if (owners.has(seat.id) && owners.get(seat.id) !== section.id) moved.set(seat.id, seat);
    }
  }
  if (moved.size === 0) return { scene };
  const sections = scene.sections.map((section) => {
    const kept = section.seats.filter((seat) => !moved.has(seat.id));
    const incoming: SeatMapSeat[] = [];
    for (const [seatId, seat] of moved) {
      if (owners.get(seatId) === section.id) incoming.push(seat);
    }
    if (kept.length === section.seats.length && incoming.length === 0) return section;
    return { ...section, seats: [...kept, ...incoming] };
  });
  return { scene: { ...scene, sections } };
}

/** "Paint zone": move seats to another section without touching geometry. */
export function reassignSeatsCommand(
  label: string,
  before: readonly SeatOwnership[],
  targetSectionId: string,
): EditorCommand {
  const forward = new Map(before.map((entry) => [entry.seatId, targetSectionId] as const));
  const backward = new Map(before.map((entry) => [entry.seatId, entry.sectionId] as const));
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => applyOwnership(scene, forward),
    revert: (scene) => applyOwnership(scene, backward),
  };
}

export type VenuePatch = Partial<SeatMapVenueMeta>;

function applyVenuePatch(scene: SeatMapData, patch: VenuePatch): SceneMutation {
  return { scene: { ...scene, venue: { ...(scene.venue ?? {}), ...patch } } };
}

export function setVenueMetaCommand(
  label: string,
  before: VenuePatch,
  after: VenuePatch,
): EditorCommand {
  return {
    id: nextCommandId(),
    label,
    apply: (scene) => applyVenuePatch(scene, after),
    revert: (scene) => applyVenuePatch(scene, before),
  };
}

/**
 * Whole-map command for coarse operations (templates, CAD import, block
 * regeneration). Both scenes are immutable and share every untouched section,
 * so keeping them on the stack costs only what actually changed. Targeted
 * commands are still preferred for seat edits because they can emit a
 * `SeatPatch` and skip the renderer's scene rebuild.
 */
export function replaceSceneCommand(
  label: string,
  before: SeatMapData,
  after: SeatMapData,
): EditorCommand {
  return {
    id: nextCommandId(),
    label,
    apply: () => ({ scene: after }),
    revert: () => ({ scene: before }),
  };
}
