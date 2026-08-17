/**
 * Lugares accesibles y espacios de acompañante.
 *
 * Requisito legal: un recinto debe reservar plazas para silla de ruedas y, junto a
 * cada una, al menos un asiento de acompañante. La tabla `Seat` de la base de datos
 * ya tiene `accessible`, pero el documento de mapa (`SeatMapSeat` en @boletera/shared)
 * no expone ese campo, así que la marca viaja en `seat.metadata` con claves estables.
 * Cuando `SeatMapSeat` gane campos propios, basta con cambiar estos accesores.
 *
 * Identificadores en inglés, comentarios de dominio en español.
 */

import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';

/** Clases de plaza accesible reconocidas. */
export type AccessibleKind =
  /** Espacio para silla de ruedas (sin butaca física). */
  | 'wheelchair'
  /** Butaca de acompañante ligada a una plaza de silla de ruedas. */
  | 'companion'
  /** Butaca de movilidad reducida (con butaca, acceso sin escalones). */
  | 'semi-ambulatory'
  /** Plaza con apoyo para persona con discapacidad visual/auditiva. */
  | 'sensory';

export type AccessibleMeta = {
  accessible: true;
  accessibleKind: AccessibleKind;
  /** Id de la plaza de silla de ruedas a la que acompaña (solo `companion`). */
  companionOf?: string;
  /** Ids de acompañantes ligados (solo `wheelchair`). */
  companionSeatIds?: string[];
  /** Nota operativa que se imprime en el manifiesto de acceso. */
  accessNote?: string;
};

const KEY = 'accessible';
const KIND_KEY = 'accessibleKind';
const COMPANION_OF_KEY = 'companionOf';
const COMPANION_IDS_KEY = 'companionSeatIds';
const NOTE_KEY = 'accessNote';

/** ¿Es una plaza accesible de cualquier clase? */
export function isAccessible(seat: SeatMapSeat): boolean {
  return seat.metadata?.[KEY] === true;
}

/** Clase de plaza accesible, o `undefined` si la butaca es estándar. */
export function accessibleKind(seat: SeatMapSeat): AccessibleKind | undefined {
  if (!isAccessible(seat)) return undefined;
  const kind = seat.metadata?.[KIND_KEY];
  return typeof kind === 'string' ? (kind as AccessibleKind) : 'wheelchair';
}

/** ¿Es un espacio de silla de ruedas (cuenta para el cupo legal)? */
export function isWheelchairSpace(seat: SeatMapSeat): boolean {
  return accessibleKind(seat) === 'wheelchair';
}

/** ¿Es una butaca de acompañante? */
export function isCompanionSeat(seat: SeatMapSeat): boolean {
  return accessibleKind(seat) === 'companion';
}

/** Id de la plaza de silla de ruedas asociada a un acompañante. */
export function companionOf(seat: SeatMapSeat): string | undefined {
  const v = seat.metadata?.[COMPANION_OF_KEY];
  return typeof v === 'string' ? v : undefined;
}

/** Ids de acompañantes ligados a una plaza de silla de ruedas. */
export function companionSeatIds(seat: SeatMapSeat): string[] {
  const v = seat.metadata?.[COMPANION_IDS_KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Marca una butaca como accesible, preservando el resto de metadata. */
export function markAccessible(
  seat: SeatMapSeat,
  kind: AccessibleKind,
  opts?: { companionOf?: string; companionSeatIds?: string[]; note?: string },
): SeatMapSeat {
  const metadata: Record<string, unknown> = {
    ...(seat.metadata ?? {}),
    [KEY]: true,
    [KIND_KEY]: kind,
  };
  if (opts?.companionOf) metadata[COMPANION_OF_KEY] = opts.companionOf;
  if (opts?.companionSeatIds) metadata[COMPANION_IDS_KEY] = opts.companionSeatIds;
  if (opts?.note) metadata[NOTE_KEY] = opts.note;
  return { ...seat, metadata };
}

/** Quita todas las marcas de accesibilidad de una butaca. */
export function clearAccessible(seat: SeatMapSeat): SeatMapSeat {
  if (!seat.metadata) return seat;
  const {
    [KEY]: _a,
    [KIND_KEY]: _b,
    [COMPANION_OF_KEY]: _c,
    [COMPANION_IDS_KEY]: _d,
    [NOTE_KEY]: _e,
    ...rest
  } = seat.metadata;
  return { ...seat, metadata: Object.keys(rest).length ? rest : undefined };
}

/**
 * Empareja una plaza de silla de ruedas con sus acompañantes, dejando el vínculo
 * en ambos sentidos para que el manifiesto y la venta puedan bloquearlos juntos.
 */
export function linkCompanions(
  wheelchairSeat: SeatMapSeat,
  companions: SeatMapSeat[],
): { wheelchair: SeatMapSeat; companions: SeatMapSeat[] } {
  const ids = companions.map((c) => c.id);
  return {
    wheelchair: markAccessible(wheelchairSeat, 'wheelchair', { companionSeatIds: ids }),
    companions: companions.map((c) =>
      markAccessible(c, 'companion', { companionOf: wheelchairSeat.id }),
    ),
  };
}

/**
 * Cupo legal de plazas de silla de ruedas por aforo.
 *
 * Escala tomada del criterio más extendido (ADA en EE. UU., replicado de facto en
 * la normativa mexicana de accesibilidad para recintos de espectáculos):
 * 1 por cada 25 hasta 100, luego tramos decrecientes.
 * Se expone como función para poder ajustarla por jurisdicción sin tocar llamadores.
 */
export function requiredWheelchairSpaces(capacity: number): number {
  if (capacity <= 0) return 0;
  if (capacity <= 25) return 1;
  if (capacity <= 50) return 2;
  if (capacity <= 100) return 4;
  if (capacity <= 300) return 5 + Math.ceil((capacity - 100) / 100);
  if (capacity <= 500) return 7 + Math.ceil((capacity - 300) / 100);
  // Por encima de 500: 1% del aforo total.
  return Math.ceil(capacity * 0.01);
}

export type AccessibilityAudit = {
  capacity: number;
  wheelchairSpaces: number;
  requiredWheelchairSpaces: number;
  companionSeats: number;
  /** Plazas de silla de ruedas sin ningún acompañante ligado. */
  wheelchairWithoutCompanion: string[];
  /** Acompañantes cuyo `companionOf` no existe en el mapa. */
  orphanCompanions: string[];
  /** Secciones que no tienen ninguna plaza accesible. */
  sectionsWithoutAccessible: { id: string; name: string; seats: number }[];
  compliant: boolean;
};

/** Recuento y verificación de accesibilidad sobre el documento de mapa completo. */
export function auditAccessibility(map: SeatMapData): AccessibilityAudit {
  const allSeats = map.sections.flatMap((s) => s.seats);
  const byId = new Map(allSeats.map((s) => [s.id, s]));

  const wheelchair = allSeats.filter(isWheelchairSpace);
  const companions = allSeats.filter(isCompanionSeat);

  const wheelchairWithoutCompanion = wheelchair
    .filter((w) => {
      const linked = companionSeatIds(w);
      if (linked.some((id) => byId.has(id))) return false;
      // También vale que un acompañante apunte a esta plaza sin vínculo inverso.
      return !companions.some((c) => companionOf(c) === w.id);
    })
    .map((w) => w.id);

  const orphanCompanions = companions
    .filter((c) => {
      const target = companionOf(c);
      return !target || !byId.has(target);
    })
    .map((c) => c.id);

  const sectionsWithoutAccessible = map.sections
    .filter((s) => s.seats.length > 0 && !s.seats.some(isAccessible))
    .map((s) => ({ id: s.id, name: s.name, seats: s.seats.length }));

  const capacity = allSeats.length;
  const required = requiredWheelchairSpaces(capacity);

  return {
    capacity,
    wheelchairSpaces: wheelchair.length,
    requiredWheelchairSpaces: required,
    companionSeats: companions.length,
    wheelchairWithoutCompanion,
    orphanCompanions,
    sectionsWithoutAccessible,
    compliant:
      wheelchair.length >= required &&
      wheelchairWithoutCompanion.length === 0 &&
      orphanCompanions.length === 0,
  };
}

export type GenerateAccessibleOptions = {
  /** Cuántas plazas de silla de ruedas crear. Por defecto, el cupo legal. */
  count?: number;
  /** Acompañantes por plaza (por defecto 1). */
  companionsPerSpace?: number;
  /**
   * Dónde colocarlas. `row-end` las pone al final de la fila elegida (lo habitual:
   * acceso lateral sin escalones); `row-start` al principio.
   */
  placement?: 'row-end' | 'row-start';
  /**
   * Índice de fila preferido (0-based). Por defecto la última fila de la sección,
   * que suele ser la que tiene acceso a nivel desde el vomitorio.
   */
  rowIndex?: number;
  /** Separación entre plazas accesibles en unidades de mapa (silla ≈ 1.4× butaca). */
  spacing?: number;
  note?: string;
};

/**
 * Convierte butacas existentes de una sección en plazas accesibles + acompañantes.
 *
 * No inventa geometría nueva: reutiliza butacas ya generadas para no romper el
 * aforo declarado ni crear solapamientos. Devuelve la sección modificada.
 */
export function generateAccessibleSpaces(
  section: SeatMapSection,
  opts: GenerateAccessibleOptions = {},
): { section: SeatMapSection; created: { wheelchair: string[]; companions: string[] } } {
  const companionsPerSpace = Math.max(0, opts.companionsPerSpace ?? 1);
  const count = Math.max(0, opts.count ?? requiredWheelchairSpaces(section.seats.length));
  const placement = opts.placement ?? 'row-end';

  if (!count || !section.seats.length) {
    return { section, created: { wheelchair: [], companions: [] } };
  }

  // Agrupar por fila conservando el orden de generación (izquierda→derecha).
  const rows = new Map<string, SeatMapSeat[]>();
  for (const seat of section.seats) {
    const key = seat.row ?? '';
    const arr = rows.get(key) ?? [];
    arr.push(seat);
    rows.set(key, arr);
  }
  const rowKeys = [...rows.keys()];
  if (!rowKeys.length) return { section, created: { wheelchair: [], companions: [] } };

  const targetRowKey =
    opts.rowIndex != null && rowKeys[opts.rowIndex] != null
      ? rowKeys[opts.rowIndex]
      : rowKeys[rowKeys.length - 1];

  const patched = new Map<string, SeatMapSeat>();
  const wheelchairIds: string[] = [];
  const companionIds: string[] = [];

  // Se consumen butacas desde el extremo elegido: cada plaza necesita
  // 1 espacio de silla + N acompañantes contiguos.
  const groupSize = 1 + companionsPerSpace;
  let rowCursor = rowKeys.indexOf(targetRowKey);

  for (let made = 0; made < count; made++) {
    // Si la fila se queda sin butacas libres, se sube a la fila anterior.
    let placed = false;
    for (let attempt = 0; attempt < rowKeys.length && !placed; attempt++) {
      const key = rowKeys[(rowCursor - attempt + rowKeys.length) % rowKeys.length];
      const rowSeats = rows.get(key) ?? [];
      const free = rowSeats.filter((s) => !patched.has(s.id) && !isAccessible(s));
      if (free.length < groupSize) continue;

      const group =
        placement === 'row-end' ? free.slice(-groupSize).reverse() : free.slice(0, groupSize);

      const [wheelchairSeat, ...companionSeats] = group;
      const linked = linkCompanions(wheelchairSeat, companionSeats);

      patched.set(linked.wheelchair.id, {
        ...linked.wheelchair,
        metadata: {
          ...(linked.wheelchair.metadata ?? {}),
          ...(opts.note ? { accessNote: opts.note } : {}),
        },
      });
      wheelchairIds.push(linked.wheelchair.id);
      for (const c of linked.companions) {
        patched.set(c.id, c);
        companionIds.push(c.id);
      }
      placed = true;
    }
    if (!placed) break;
  }

  return {
    section: {
      ...section,
      seats: section.seats.map((s) => patched.get(s.id) ?? s),
    },
    created: { wheelchair: wheelchairIds, companions: companionIds },
  };
}

/** Aplica `generateAccessibleSpaces` a todas las secciones del mapa. */
export function ensureAccessibleSpaces(
  map: SeatMapData,
  opts: GenerateAccessibleOptions = {},
): SeatMapData {
  const totalRequired = opts.count ?? requiredWheelchairSpaces(
    map.sections.reduce((n, s) => n + s.seats.length, 0),
  );
  const totalSeats = map.sections.reduce((n, s) => n + s.seats.length, 0) || 1;

  return {
    ...map,
    sections: map.sections.map((sec) => {
      // Reparto proporcional al tamaño de cada sección.
      const share = Math.round((sec.seats.length / totalSeats) * totalRequired);
      if (share <= 0) return sec;
      return generateAccessibleSpaces(sec, { ...opts, count: share }).section;
    }),
  };
}
