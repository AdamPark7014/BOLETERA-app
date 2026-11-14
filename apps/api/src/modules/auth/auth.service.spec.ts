import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * Entrar en otro dispositivo no debe revocar las demás sesiones: JwtStrategy
 * invalida los tokens emitidos antes del último `updatedAt` de User, así que
 * el sello de `lastLogin` tiene que conservar ese `updatedAt`.
 */
describe('AuthService.login', () => {
  it('sella lastLogin sin mover updatedAt', async () => {
    const previous = new Date('2026-11-01T10:00:00.000Z');
    const user = {
      id: 'u1',
      email: 'admin@example.test',
      password: await bcrypt.hash('secreto-123', 4),
      active: true,
      role: 'ADMIN',
      organizationId: null,
      firstName: 'A',
      lastName: 'B',
      updatedAt: previous,
    };
    const update = jest.fn().mockResolvedValue(user);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user), update },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const jwt = { sign: jest.fn().mockReturnValue('token') };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.login(user.email, 'secreto-123')).resolves.toMatchObject({
      accessToken: 'token',
    });

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.lastLogin).toBeInstanceOf(Date);
    expect(data.updatedAt).toBe(previous);
  });
});
