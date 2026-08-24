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

/** Prisma filter: exclude events marked private or hidden in metadata. */
export function publicCatalogEventWhere(): Prisma.EventWhereInput {
  return {
    AND: [
      {
        OR: [
          { metadata: { equals: Prisma.DbNull } },
          { metadata: { equals: Prisma.JsonNull } },
          {
            NOT: {
              metadata: { path: ['visibility'], equals: 'private' },
            },
          },
        ],
      },
      {
        OR: [
          { metadata: { equals: Prisma.DbNull } },
          { metadata: { equals: Prisma.JsonNull } },
          {
            NOT: {
              metadata: { path: ['visibility'], equals: 'hidden' },
            },
          },
        ],
      },
    ],
  };
}
