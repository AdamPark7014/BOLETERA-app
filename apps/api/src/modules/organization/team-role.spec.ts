import { UserRole } from '@prisma/client';
import { assertCatalogRole, catalogRoles } from './team-role';

describe('catálogo de roles del personal', () => {
  it('acepta los 15 de Prisma y rechaza lo demás', () => {
    const roles = catalogRoles();
    expect(roles).toHaveLength(15);
    expect(new Set(roles)).toEqual(new Set(Object.values(UserRole)));
    for (const role of roles) {
      expect(assertCatalogRole(role)).toBe(role);
    }
    expect(assertCatalogRole(undefined)).toBeUndefined();
    expect(() => assertCatalogRole('OWNER')).toThrow(/15/);
    expect(() => assertCatalogRole('')).toThrow(/15/);
    expect(() => assertCatalogRole(null)).toThrow(/15/);
  });
});
