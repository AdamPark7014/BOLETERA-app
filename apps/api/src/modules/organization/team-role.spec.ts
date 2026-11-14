import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ROLE_RANK,
  assertCanGrant,
  assertCanModifyMember,
  assertCatalogRole,
  canGrantRole,
  catalogRoles,
  grantableRoles,
} from './team-role';

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

describe('quién concede y modifica roles del personal', () => {
  const org = 'org-1';
  const admin = { sub: 'a1', role: 'ADMIN', organizationId: org };
  const promoter = { sub: 'p1', role: 'PROMOTER', organizationId: org };
  const superAdmin = { sub: 's1', role: 'SUPER_ADMIN', organizationId: null };
  const member = (role: UserRole, id = 'u1', organizationId: string | null = org) => ({
    id,
    role,
    organizationId,
  });

  it('solo SUPER_ADMIN concede SUPER_ADMIN', () => {
    expect(canGrantRole('ADMIN', UserRole.SUPER_ADMIN)).toBe(false);
    expect(canGrantRole('PROMOTER', UserRole.SUPER_ADMIN)).toBe(false);
    expect(canGrantRole('SUPER_ADMIN', UserRole.SUPER_ADMIN)).toBe(true);
    expect(grantableRoles('ADMIN')).not.toContain(UserRole.SUPER_ADMIN);
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.SCANNER), { role: UserRole.SUPER_ADMIN })
    ).toThrow(ForbiddenException);
  });

  it('solo SUPER_ADMIN toca a un SUPER_ADMIN', () => {
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.SUPER_ADMIN), { role: UserRole.CUSTOMER })
    ).toThrow(/super administrador/);
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.SUPER_ADMIN), { active: false })
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanModifyMember(superAdmin, member(UserRole.SUPER_ADMIN, 's2', 'otra'), {
        role: UserRole.ADMIN,
      })
    ).not.toThrow();
  });

  it('nadie modifica a alguien de rango igual o mayor', () => {
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.ADMIN, 'a2'), { role: UserRole.SCANNER })
    ).toThrow(/mismo rango/);
    expect(() =>
      assertCanModifyMember(promoter, member(UserRole.ADMIN), { active: false })
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanModifyMember(promoter, member(UserRole.FINANCE), { role: UserRole.SCANNER })
    ).toThrow(ForbiddenException);
  });

  it('nadie concede un rol por encima del suyo', () => {
    expect(() =>
      assertCanModifyMember(promoter, member(UserRole.SCANNER), { role: UserRole.ADMIN })
    ).toThrow(/por encima/);
    expect(() => assertCanGrant(promoter, UserRole.ADMIN)).toThrow(ForbiddenException);
    expect(() =>
      assertCanModifyMember(promoter, member(UserRole.SCANNER), { role: UserRole.PROMOTER })
    ).not.toThrow();
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.PROMOTER), { role: UserRole.ADMIN })
    ).not.toThrow();
  });

  it('nadie cambia su propio rol ni se desactiva', () => {
    expect(() =>
      assertCanModifyMember(promoter, member(UserRole.PROMOTER, 'p1'), {
        role: UserRole.SUPER_ADMIN,
      })
    ).toThrow(/propio rol/);
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.ADMIN, 'a1'), { active: false })
    ).toThrow(/propia cuenta/);
    expect(() =>
      assertCanModifyMember(superAdmin, member(UserRole.SUPER_ADMIN, 's1', null), {
        role: UserRole.ADMIN,
      })
    ).toThrow(/propio rol/);
  });

  it('la persona tiene que ser de la organización del actor, salvo SUPER_ADMIN', () => {
    expect(() =>
      assertCanModifyMember(admin, member(UserRole.SCANNER, 'u9', 'otra'), {
        role: UserRole.TAQUILLA,
      })
    ).toThrow(/organización/);
    expect(() =>
      assertCanModifyMember(superAdmin, member(UserRole.SCANNER, 'u9', 'otra'), {
        role: UserRole.TAQUILLA,
      })
    ).not.toThrow();
  });

  it('todos los roles del catálogo tienen rango', () => {
    for (const role of catalogRoles()) expect(typeof ROLE_RANK[role]).toBe('number');
  });
});
