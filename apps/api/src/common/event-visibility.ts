import { Prisma } from '@prisma/client';

type EventMetadata = {
  visibility?: string;
} | null;

/** Event catalog visibility stored in `Event.metadata.visibility`. */
export function eventVisibility(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as EventMetadata)?.visibility;
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function isPublicCatalogEvent(metadata: unknown): boolean {
  const visibility = eventVisibility(metadata);
  return visibility !== 'private' && visibility !== 'hidden';
}

/**
 * Un valor de `visibility` que no excluye al evento.
 *
 * La rama `AnyNull` sobre la ruta no es redundante: cuando `metadata` existe
 * pero no trae la llave, Postgres evalúa `NOT (NULL = 'private')` como NULL y
 * el `NOT` solo dejaba fuera a casi toda la cartelera (todo evento con canales
 * guardados en metadata y sin `visibility`).
 */
function visibilityIsNot(value: 'private' | 'hidden'): Prisma.EventWhereInput {
  return {
    OR: [
      { metadata: { equals: Prisma.DbNull } },
      { metadata: { equals: Prisma.JsonNull } },
      { metadata: { path: ['visibility'], equals: Prisma.AnyNull } },
      { NOT: { metadata: { path: ['visibility'], equals: value } } },
    ],
  };
}

/** Prisma filter: exclude events marked private or hidden in metadata. */
export function publicCatalogEventWhere(): Prisma.EventWhereInput {
  return {
    AND: [visibilityIsNot('private'), visibilityIsNot('hidden')],
  };
}
