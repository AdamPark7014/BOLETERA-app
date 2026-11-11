import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BuyerSelfServiceService } from './buyer-self-service.service';

/**
 * Pruebas de las acciones del comprador. `OrdersService.authorizeBuyerAction`
 * se sustituye: su regla de acceso es la de `GET /orders/:publicId` y aquí se
 * prueba lo que viene después (guardas del reembolso, límite de reenvíos).
 */

const VALID_CLABE = '032180000118359719';

type FakeOrder = {
  id: string;
  publicId: string;
  status: string;
  userId: string | null;
  buyerEmail: string;
  buyerName: string | null;
  paymentMethod: string | null;
  payment: { method: string } | null;
};

function order(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: 'ord_1',
    publicId: 'PUB-1',
    status: 'COMPLETED',
    userId: 'user_1',
    buyerEmail: 'comprador@example.com',
    buyerName: 'Comprador',
    paymentMethod: 'OXXO',
    payment: null,
    ...overrides,
  };
}

/** Redis falso con la semántica que usa el servicio (SET NX + contador con TTL). */
function fakeRedis(ready = true) {
  const store = new Map<string, string>();
  return {
    store,
    get isReady() {
      return ready;
    },
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    acquireLock: jest.fn(async (key: string, token: string) => {
      if (store.has(key)) return 'TAKEN' as const;
      store.set(key, token);
      return 'ACQUIRED' as const;
    }),
    incrementWithTtl: jest.fn(async (key: string, amount: number) => {
      const next = Number(store.get(key) ?? 0) + amount;
      store.set(key, String(next));
      return next;
    }),
  };
}

function setup(
  opts: {
    order?: FakeOrder | Error;
    refund?: { id: string; status: string } | null;
    redisReady?: boolean;
  } = {}
) {
  const current = opts.order ?? order();
  const orders = {
    authorizeBuyerAction: jest.fn(async () => {
      if (current instanceof Error) throw current;
      return current;
    }),
  };
  const prisma = {
    refund: {
      findFirst: jest.fn(async () =>
        opts.refund === undefined ? { id: 'ref_1', status: 'PENDING' } : opts.refund
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ref_1',
        payoutClabe: data.payoutClabe,
        payoutAccountHolder: data.payoutAccountHolder,
        payoutClabeAt: data.payoutClabeAt,
      })),
    },
  };
  const notifications = {
    enqueueOrderConfirmation: jest.fn(async () => undefined),
    enqueueTicketPDF: jest.fn(async () => undefined),
  };
  const redis = fakeRedis(opts.redisReady ?? true);
  const service = new BuyerSelfServiceService(
    orders as never,
    prisma as never,
    notifications as never,
    redis as never
  );
  return { service, orders, prisma, notifications, redis };
}

const requester = { userId: 'user_1' };

describe('POST /orders/:publicId/resend', () => {
  it('reenvía con el mismo envío del admin y enmascara el correo', async () => {
    const { service, notifications } = setup();
    const result = await service.resendTickets('PUB-1', requester);

    expect(notifications.enqueueOrderConfirmation).toHaveBeenCalledWith(
      'ord_1',
      'comprador@example.com',
      'Comprador'
    );
    expect(notifications.enqueueTicketPDF).toHaveBeenCalledWith('ord_1', 'comprador@example.com');
    expect(result).toEqual({ ok: true, sentTo: 'co•••@ex•••.com' });
    expect(JSON.stringify(result)).not.toContain('comprador@example.com');
  });

  it('no reenvía si la orden es ajena (la guarda de acceso manda)', async () => {
    const { service, notifications } = setup({
      order: new ForbiddenException('No tienes acceso a esta orden'),
    });
    await expect(service.resendTickets('PUB-1', { userId: 'otro' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(notifications.enqueueTicketPDF).not.toHaveBeenCalled();
  });

  it('no reenvía una orden sin pagar', async () => {
    const { service } = setup({ order: order({ status: 'PENDING' }) });
    await expect(service.resendTickets('PUB-1', requester)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('responde 429 si se pide dos veces en el mismo minuto', async () => {
    const { service, notifications } = setup();
    await service.resendTickets('PUB-1', requester);
    const second = service.resendTickets('PUB-1', requester);
    await expect(second).rejects.toBeInstanceOf(HttpException);
    await second.catch((error: HttpException) => {
      expect(error.getStatus()).toBe(429);
      expect((error.getResponse() as { message: string }).message).toMatch(/Espera un minuto/);
    });
    expect(notifications.enqueueTicketPDF).toHaveBeenCalledTimes(1);
  });

  it('responde 429 al cuarto reenvío de la hora aunque pase el minuto', async () => {
    const { service, redis, notifications } = setup();
    for (let i = 0; i < 3; i += 1) {
      await service.resendTickets('PUB-1', requester);
      redis.store.delete('orders:resend:min:ord_1'); // vence el candado de un minuto
    }
    const fourth = service.resendTickets('PUB-1', requester);
    await fourth.catch((error: HttpException) => {
      expect(error.getStatus()).toBe(429);
      expect((error.getResponse() as { message: string }).message).toMatch(/3 veces/);
    });
    await expect(fourth).rejects.toBeInstanceOf(HttpException);
    expect(notifications.enqueueTicketPDF).toHaveBeenCalledTimes(3);
  });

  it('el límite es por orden: otra orden no se ve afectada', async () => {
    const a = setup();
    await a.service.resendTickets('PUB-1', requester);
    a.orders.authorizeBuyerAction.mockResolvedValueOnce(order({ id: 'ord_2', publicId: 'PUB-2' }));
    await expect(a.service.resendTickets('PUB-2', requester)).resolves.toMatchObject({ ok: true });
  });

  it('sin Redis aplica el mismo límite en memoria', async () => {
    const { service } = setup({ redisReady: false });
    await service.resendTickets('PUB-1', requester);
    await expect(service.resendTickets('PUB-1', requester)).rejects.toMatchObject({ status: 429 });
  });
});

describe('PATCH /orders/:publicId/refunds/:refundId/clabe', () => {
  const body = { clabe: VALID_CLABE, accountHolder: '  Titular de Prueba  ' };

  it('guarda CLABE y titular y responde enmascarado', async () => {
    const { service, prisma } = setup();
    const result = await service.savePayoutClabe('PUB-1', 'ref_1', requester, body);

    expect(prisma.refund.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ref_1', orderId: 'ord_1' } })
    );
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payoutClabe: VALID_CLABE,
          payoutAccountHolder: 'Titular de Prueba',
        }),
      })
    );
    expect(result.payoutClabe).toBe('••••••••••••••9719');
    expect(JSON.stringify(result)).not.toContain(VALID_CLABE);
  });

  it('orden ajena: no toca el reembolso', async () => {
    const { service, prisma } = setup({
      order: new ForbiddenException('No tienes acceso a esta orden'),
    });
    await expect(
      service.savePayoutClabe('PUB-1', 'ref_1', { userId: 'otro' }, body)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.refund.update).not.toHaveBeenCalled();
  });

  it('reembolso de otra orden: 404 sin escribir', async () => {
    const { service, prisma } = setup({ refund: null });
    await expect(service.savePayoutClabe('PUB-1', 'ref_x', requester, body)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(prisma.refund.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'FAILED', 'DISPUTED'])('reembolso %s: 409 sin escribir', async (status) => {
    const { service, prisma } = setup({ refund: { id: 'ref_1', status } });
    await expect(service.savePayoutClabe('PUB-1', 'ref_1', requester, body)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(prisma.refund.update).not.toHaveBeenCalled();
  });

  it.each(['CARD', 'CLIP', 'APPLE_PAY', 'GOOGLE_PAY', 'PAYPAL'])(
    'pago %s: el reembolso vuelve al instrumento, 409',
    async (method) => {
      const { service, prisma } = setup({ order: order({ paymentMethod: method }) });
      await expect(
        service.savePayoutClabe('PUB-1', 'ref_1', requester, body)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.refund.update).not.toHaveBeenCalled();
    }
  );

  it('el método del pago liquidado manda sobre el declarado', async () => {
    const { service } = setup({
      order: order({ paymentMethod: 'OXXO', payment: { method: 'CARD' } }),
    });
    await expect(service.savePayoutClabe('PUB-1', 'ref_1', requester, body)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('sin método conocido se permite (solo PENDING)', async () => {
    const { service } = setup({ order: order({ paymentMethod: null }) });
    await expect(service.savePayoutClabe('PUB-1', 'ref_1', requester, body)).resolves.toMatchObject(
      {
        refundId: 'ref_1',
      }
    );
  });

  it('rechaza CLABE con dígito verificador inválido', async () => {
    const { service, prisma } = setup();
    await expect(
      service.savePayoutClabe('PUB-1', 'ref_1', requester, { ...body, clabe: '012180001234567897' })
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.refund.update).not.toHaveBeenCalled();
  });

  it('exige titular', async () => {
    const { service } = setup();
    await expect(
      service.savePayoutClabe('PUB-1', 'ref_1', requester, { ...body, accountHolder: ' ' })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('OrdersService.authorizeBuyerAction (misma regla que GET /orders/:publicId)', () => {
  // Import diferido: el módulo de órdenes inicializa proveedores de pago al cargarse.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrdersService } = require('./orders.service') as typeof import('./orders.service');

  function ordersWith(found: Record<string, unknown> | null, userEmail: string | null = null) {
    const prisma = {
      order: { findUnique: jest.fn(async () => found) },
      user: { findUnique: jest.fn(async () => (userEmail ? { email: userEmail } : null)) },
    };
    const args = [prisma, ...Array(8).fill(undefined)] as unknown as ConstructorParameters<
      typeof OrdersService
    >;
    return new OrdersService(...args);
  }

  const stored = {
    id: 'ord_1',
    publicId: 'PUB-1',
    status: 'COMPLETED',
    userId: 'owner',
    buyerEmail: 'dueno@example.com',
    buyerName: 'Dueño',
    paymentMethod: 'OXXO',
    accessTokenHash: null,
    accessTokenAt: null,
    payment: null,
  };

  it('el dueño pasa y no recibe el hash del token', async () => {
    const result = await ordersWith(stored).authorizeBuyerAction('PUB-1', { userId: 'owner' });
    expect(result).toMatchObject({ id: 'ord_1' });
    expect(result).not.toHaveProperty('accessTokenHash');
  });

  it('otra cuenta sin token: 403', async () => {
    await expect(
      ordersWith(stored, 'otra@example.com').authorizeBuyerAction('PUB-1', { userId: 'intruso' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin credencial: 403', async () => {
    await expect(ordersWith(stored).authorizeBuyerAction('PUB-1', {})).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('orden inexistente: 404', async () => {
    await expect(
      ordersWith(null).authorizeBuyerAction('NOPE', { userId: 'owner' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
