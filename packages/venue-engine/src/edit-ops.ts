/**
 * Operaciones de edición masiva y pila de deshacer.
 *
 * El editor guardaba el historial como 40 clones profundos del documento. Con
 * 45.000 butacas cada clon ronda las decenas de megabytes: la pestaña se queda
 * sin memoria antes de la vigésima acción, y cada `cloneMap` bloquea el hilo.
 *
 * Aquí el historial guarda *comandos* con solo los datos que cambian, y las
 * mutaciones reutilizan por referencia (`structural sharing`) todo lo que no se
 * toca: una sección no editada conserva su identidad y su array de butacas.
 *
 * Identificadores en inglés, comentarios de dominio en español.
 */

import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';

/** Campos de butaca que la edición masiva puede fijar. */
export type SeatEditableProps = Pick<SeatMapSeat, 'tier' | 'visibility' | 'levelId' | 'metadata'>;

/** Valores previos de una butaca, guardados para poder deshacer. */
type SeatSnapshot = { id: string; prev: Partial<SeatMapSeat> };

export type EditCommand =
  | {
      kind: 'seat-props';
      label: string;
      /** Valores anteriores, uno por butaca afectada. */
      before: SeatSnapshot[];
      after: Partial<SeatMapSeat>;
    }
  | {
      kind: 'seat-move';
      label: string;
      before: { id: string; x: number; y: number }[];
      dx: number;
      dy: number;
    }
  | {
      kind: 'seat-section';
      label: string;
      /** Sección de origen de cada butaca, para poder devolverlas. */
      before: { id: string; sectionId: string }[];
      toSectionId: string;
    }
  | {
      kind: 'snapshot';
      label: string;
      /**
       * Cambio estructural (plantillas, importación, regeneración): no hay forma
       * compacta de invertirlo, así que se guarda el documento completo. Se usa
       * poco y la pila lo limita aparte.
       */
      before: SeatMapData;
      after: SeatMapData;
    };

/* ── Aplicación de cambios con reutilización por referencia ─────────────────── */

/**
 * Fija propiedades sobre un conjunto de butacas.
 * Solo se reconstruyen las secciones que contienen alguna butaca afectada.
 */
export function applySeatProps(
  map: SeatMapData,
  seatIds: ReadonlySet<string>,
  props: Partial<SeatMapSeat>,
): { map: SeatMapData; before: SeatSnapshot[] } {
  if (!seatIds.size) return { map, before: [] };
  const before: SeatSnapshot[] = [];
  const keys = Object.keys(props) as (keyof SeatMapSeat)[];

  const sections = map.sections.map((sec) => {
    let touched = false;
    const seats = sec.seats.map((seat) => {
      if (!seatIds.has(seat.id)) return seat;
      touched = true;
      const prev: Partial<SeatMapSeat> = {};
      for (const k of keys) (prev as Record<string, unknown>)[k] = seat[k];
      before.push({ id: seat.id, prev });
      return { ...seat, ...props };
    });
    // Sin cambios: se devuelve la misma sección para no invalidar memos aguas abajo.
    return touched ? { ...sec, seats } : sec;
  });

  return { map: { ...map, sections }, before };
}

/** Restaura valores previos butaca a butaca (inverso de `applySeatProps`). */
export function restoreSeatProps(map: SeatMapData, before: SeatSnapshot[]): SeatMapData {
  if (!before.length) return map;
  const byId = new Map(before.map((b) => [b.id, b.prev]));

  const sections = map.sections.map((sec) => {
    let touched = false;
    const seats = sec.seats.map((seat) => {
      const prev = byId.get(seat.id);
      if (!prev) return seat;
      touched = true;
      return { ...seat, ...prev };
    });
    return touched ? { ...sec, seats } : sec;
  });

  return { ...map, sections };
}

/** Desplaza butacas manteniendo coherentes `position` y `coord3d`. */
export function applySeatMove(
  map: SeatMapData,
  seatIds: ReadonlySet<string>,
  dx: number,
  dy: number,
  opts?: { round?: boolean },
): SeatMapData {
  if (!seatIds.size || (dx === 0 && dy === 0)) return map;
  const round = opts?.round ?? true;
  const q = (v: number) => (round ? Math.round(v) : v);

  const sections = map.sections.map((sec) => {
    if (sec.locked) return sec;
    let touched = false;
    const seats = sec.seats.map((seat) => {
      if (!seatIds.has(seat.id)) return seat;
      touched = true;
      const x = q(seat.x + dx);
      const y = q(seat.y + dy);
      const elev = seat.elevation ?? seat.position?.y ?? 0;
      return {
        ...seat,
        x,
        y,
        position: { x, y: elev, z: y },
        coord3d: {
          x,
          y: elev,
          z: y,
          pitch: seat.rotation3d?.x ?? seat.coord3d?.pitch,
          roll: seat.rotation3d?.z ?? seat.coord3d?.roll,
        },
      };
    });
    return touched ? { ...sec, seats } : sec;
  });

  return { ...map, sections };
}

/** Coloca butacas en posiciones absolutas (inverso exacto de un arrastre). */
export function restoreSeatPositions(
  map: SeatMapData,
  before: { id: string; x: number; y: number }[],
): SeatMapData {
  if (!before.length) return map;
  const byId = new Map(before.map((b) => [b.id, b]));

  const sections = map.sections.map((sec) => {
    let touched = false;
    const seats = sec.seats.map((seat) => {
      const prev = byId.get(seat.id);
      if (!prev) return seat;
      touched = true;
      const elev = seat.elevation ?? seat.position?.y ?? 0;
      return {
        ...seat,
        x: prev.x,
        y: prev.y,
        position: { x: prev.x, y: elev, z: prev.y },
        coord3d: { ...(seat.coord3d ?? {}), x: prev.x, y: elev, z: prev.y },
      };
    });
    return touched ? { ...sec, seats } : sec;
  });

  return { ...map, sections };
}

/**
 * Mueve butacas de zona (cambio masivo de sección).
 * Es la operación que permite repintar miles de butacas a otra zona de precio.
 */
export function applySeatSection(
  map: SeatMapData,
  seatIds: ReadonlySet<string>,
  toSectionId: string,
): { map: SeatMapData; before: { id: string; sectionId: string }[] } {
  if (!seatIds.size) return { map, before: [] };
  const target = map.sections.find((s) => s.id === toSectionId);
  if (!target) return { map, before: [] };

  const before: { id: string; sectionId: string }[] = [];
  const moved: SeatMapSeat[] = [];

  const stripped = map.sections.map((sec) => {
    if (sec.id === toSectionId) return sec;
    let touched = false;
    const seats: SeatMapSeat[] = [];
    for (const seat of sec.seats) {
      if (seatIds.has(seat.id) && !sec.locked) {
        touched = true;
        before.push({ id: seat.id, sectionId: sec.id });
        moved.push(seat);
      } else {
        seats.push(seat);
      }
    }
    return touched ? { ...sec, seats } : sec;
  });

  if (!moved.length) return { map, before: [] };

  const sections = stripped.map((sec) =>
    sec.id === toSectionId ? { ...sec, seats: [...sec.seats, ...moved] } : sec,
  );

  return { map: { ...map, sections }, before };
}

/** Devuelve butacas a su sección original. */
export function restoreSeatSections(
  map: SeatMapData,
  before: { id: string; sectionId: string }[],
): SeatMapData {
  if (!before.length) return map;
  const homeById = new Map(before.map((b) => [b.id, b.sectionId]));

  // Se extraen de donde estén y se reparten a su sección de origen.
  const pulled = new Map<string, SeatMapSeat[]>();
  const stripped = map.sections.map((sec) => {
    let touched = false;
    const seats: SeatMapSeat[] = [];
    for (const seat of sec.seats) {
      const home = homeById.get(seat.id);
      if (home && home !== sec.id) {
        touched = true;
        const arr = pulled.get(home) ?? [];
        arr.push(seat);
        pulled.set(home, arr);
      } else {
        seats.push(seat);
      }
    }
    return touched ? { ...sec, seats } : sec;
  });

  if (!pulled.size) return map;

  const sections = stripped.map((sec) => {
    const incoming = pulled.get(sec.id);
    return incoming?.length ? { ...sec, seats: [...sec.seats, ...incoming] } : sec;
  });

  return { ...map, sections };
}

/* ── Pila de deshacer/rehacer ──────────────────────────────────────────────── */

export type HistoryState = {
  commands: EditCommand[];
  /** Índice del último comando aplicado; -1 = estado inicial. */
  cursor: number;
};

export const EMPTY_HISTORY: HistoryState = { commands: [], cursor: -1 };

/** Tope de comandos. Los `snapshot` pesan, así que se limitan aparte. */
export const HISTORY_LIMIT = 80;
export const SNAPSHOT_LIMIT = 8;

/** Añade un comando, descartando el futuro y podando lo viejo. */
export function pushCommand(history: HistoryState, command: EditCommand): HistoryState {
  const kept = history.commands.slice(0, history.cursor + 1);
  kept.push(command);

  // Poda por número total…
  let trimmed = kept.length > HISTORY_LIMIT ? kept.slice(kept.length - HISTORY_LIMIT) : kept;

  // …y por número de instantáneas completas, que son las caras.
  let snapshots = trimmed.filter((c) => c.kind === 'snapshot').length;
  if (snapshots > SNAPSHOT_LIMIT) {
    const out: EditCommand[] = [];
    for (const c of trimmed) {
      if (c.kind === 'snapshot' && snapshots > SNAPSHOT_LIMIT) {
        snapshots--;
        continue;
      }
      out.push(c);
    }
    trimmed = out;
  }

  return { commands: trimmed, cursor: trimmed.length - 1 };
}

export function canUndo(history: HistoryState): boolean {
  return history.cursor >= 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.cursor < history.commands.length - 1;
}

/** Etiqueta del siguiente deshacer, para mostrarla en la interfaz. */
export function undoLabel(history: HistoryState): string | null {
  return canUndo(history) ? history.commands[history.cursor].label : null;
}

export function redoLabel(history: HistoryState): string | null {
  return canRedo(history) ? history.commands[history.cursor + 1].label : null;
}

/** Invierte un comando sobre el mapa. */
export function invertCommand(map: SeatMapData, command: EditCommand): SeatMapData {
  switch (command.kind) {
    case 'seat-props':
      return restoreSeatProps(map, command.before);
    case 'seat-move':
      return restoreSeatPositions(map, command.before);
    case 'seat-section':
      return restoreSeatSections(map, command.before);
    case 'snapshot':
      return command.before;
  }
}

/** Reaplica un comando sobre el mapa. */
export function reapplyCommand(map: SeatMapData, command: EditCommand): SeatMapData {
  switch (command.kind) {
    case 'seat-props': {
      const ids = new Set(command.before.map((b) => b.id));
      return applySeatProps(map, ids, command.after).map;
    }
    case 'seat-move': {
      const ids = new Set(command.before.map((b) => b.id));
      return applySeatMove(map, ids, command.dx, command.dy);
    }
    case 'seat-section': {
      const ids = new Set(command.before.map((b) => b.id));
      return applySeatSection(map, ids, command.toSectionId).map;
    }
    case 'snapshot':
      return command.after;
  }
}

export function undo(
  map: SeatMapData,
  history: HistoryState,
): { map: SeatMapData; history: HistoryState } {
  if (!canUndo(history)) return { map, history };
  const command = history.commands[history.cursor];
  return {
    map: invertCommand(map, command),
    history: { ...history, cursor: history.cursor - 1 },
  };
}

export function redo(
  map: SeatMapData,
  history: HistoryState,
): { map: SeatMapData; history: HistoryState } {
  if (!canRedo(history)) return { map, history };
  const command = history.commands[history.cursor + 1];
  return {
    map: reapplyCommand(map, command),
    history: { ...history, cursor: history.cursor + 1 },
  };
}

/* ── Utilidades de tamaño de documento ─────────────────────────────────────── */

/**
 * Estima el peso del documento serializado sin construirlo entero.
 *
 * El API guarda el mapa completo en cada PUT (no hay parcheo parcial), así que
 * la interfaz debe poder avisar antes de mandar varios megabytes.
 */
export function estimateMapBytes(map: SeatMapData): number {
  let seats = 0;
  for (const sec of map.sections) seats += sec.seats.length;
  // ~230 bytes por butaca serializada (id, etiqueta, x/y, position, coord3d,
  // rotation3d, tier) medido sobre mapas reales v3, más el resto del documento.
  const BYTES_PER_SEAT = 230;
  const overhead = 4096 + map.sections.length * 512;
  return seats * BYTES_PER_SEAT + overhead;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cuenta butacas sin materializar la lista. */
export function countSeats(map: SeatMapData): number {
  let n = 0;
  for (const sec of map.sections) n += sec.seats.length;
  return n;
}

/**
 * Ejecuta un trabajo por lotes cediendo el hilo entre tandas.
 *
 * Para operaciones que sí son caras (regenerar geometría de miles de butacas)
 * evita el bloqueo largo de la interfaz y permite pintar progreso.
 */
export async function runChunked<T>(
  items: readonly T[],
  chunkSize: number,
  work: (item: T, index: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = items.length;
  for (let i = 0; i < total; i += chunkSize) {
    const end = Math.min(i + chunkSize, total);
    for (let k = i; k < end; k++) work(items[k], k);
    onProgress?.(end, total);
    // Cede al navegador para que pinte y atienda eventos.
    // Se busca en `globalThis` en vez de usar el identificador suelto porque
    // este paquete también se compila para Node (lo importa el API), donde no
    // existe la librería DOM y `typeof requestAnimationFrame` no compilaría.
    await new Promise<void>((resolve) => {
      const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown })
        .requestAnimationFrame;
      if (typeof raf === 'function') raf(() => resolve());
      else setTimeout(resolve, 0);
    });
  }
}

/** Aplica una renumeración a todas las butacas de una sección. */
export function replaceSectionSeats(
  map: SeatMapData,
  sectionId: string,
  seats: SeatMapSeat[],
): SeatMapData {
  return {
    ...map,
    sections: map.sections.map((sec: SeatMapSection) =>
      sec.id === sectionId ? { ...sec, seats } : sec,
    ),
  };
}
