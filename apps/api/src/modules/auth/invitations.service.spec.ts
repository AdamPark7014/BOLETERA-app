import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InvitationsService } from './invitations.service';

/** Las invitaciones usan la misma jerarquía que el cambio de rol del personal. */
describe('InvitationsService.createInvitation · rango', () => {
  const prisma = { organization: { findUnique: jest.fn().mockResolvedValue(null) } };
  const service = new InvitationsService(prisma as never);
  const base = {
    organizationId: 'org-1',
    email: 'nuevo@example.test',
    inviterOrganizationId: 'org-1',
  };

  it('un PROMOTER no invita a un ADMIN', async () => {
    await expect(
      service.createInvitation({ ...base, role: UserRole.ADMIN, inviterRole: 'PROMOTER' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un ADMIN sí invita a un PROMOTER (pasa el rango y sigue a la organización)', async () => {
    await expect(
      service.createInvitation({ ...base, role: UserRole.PROMOTER, inviterRole: 'ADMIN' })
    ).rejects.toThrow(/Organization not found/);
  });
});
