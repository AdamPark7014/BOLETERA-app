import { Prisma } from '@prisma/client';
import { isPublicCatalogEvent, publicCatalogEventWhere } from './event-visibility';

describe('event visibility', () => {
  it('trata como público el evento sin llave visibility', () => {
    expect(isPublicCatalogEvent(null)).toBe(true);
    expect(isPublicCatalogEvent({ channels: { web: { enabled: true } } })).toBe(true);
    expect(isPublicCatalogEvent({ visibility: 'private' })).toBe(false);
    expect(isPublicCatalogEvent({ visibility: ' Hidden ' })).toBe(false);
  });

  it('el filtro de Prisma admite metadata sin la llave visibility', () => {
    const where = publicCatalogEventWhere();
    const clauses = where.AND as Prisma.EventWhereInput[];
    expect(clauses).toHaveLength(2);
    for (const clause of clauses) {
      const options = clause.OR as Prisma.EventWhereInput[];
      // Sin esta rama, NOT (NULL = 'private') es NULL en Postgres y el evento desaparece.
      expect(options).toContainEqual({
        metadata: { path: ['visibility'], equals: Prisma.AnyNull },
      });
    }
  });
});
