import { createHash } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * Al confirmar el pago, el correo rota el token de acceso de invitado. El
 * token anterior (el de la pestaña donde se acaba de pagar) vale 24 h más;
 * antes el comprador quedaba fuera de su propia orden al volver del pago.
 */
describe('OrdersService · acceso de invitado tras rotar el token', () => {
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const service = new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const assertAccess = (order: object, token: string) =>
    (
      service as unknown as {
        assertOrderAccess: (o: object, r: { accessToken: string }) => Promise<void>;
      }
    ).assertOrderAccess(order, { accessToken: token });

  const base = { userId: null, buyerEmail: 'invitado@ejemplo.mx' };

  it('el token nuevo y el anterior valen dentro de las 24 h de la rotación', async () => {
    const order = {
      ...base,
      accessTokenHash: hash('nuevo'),
      accessTokenPrevHash: hash('anterior'),
      accessTokenAt: new Date(Date.now() - 60_000),
    };
    await expect(assertAccess(order, 'nuevo')).resolves.toBeUndefined();
    await expect(assertAccess(order, 'anterior')).resolves.toBeUndefined();
  });

  it('el token anterior deja de valer pasadas 24 h; uno inventado nunca vale', async () => {
    const order = {
      ...base,
      accessTokenHash: hash('nuevo'),
      accessTokenPrevHash: hash('anterior'),
      accessTokenAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    };
    await expect(assertAccess(order, 'nuevo')).resolves.toBeUndefined();
    await expect(assertAccess(order, 'anterior')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertAccess(order, 'inventado')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
