import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { posOrgScope } from './taquilla-pos.controller';
import { TaquillaPosService } from './taquilla-pos.service';

/**
 * Búsquedas de taquilla acotadas a la organización del JWT. Antes
 * `willcall/lookup` tomaba la org del cuerpo y, sin ella, buscaba por nombre y
 * correo en TODAS las organizaciones; `/taquilla/scan` no filtraba nada.
 */
describe('posOrgScope', () => {
  it('usa la org del JWT aunque el cuerpo pida otra', () => {
    expect(posOrgScope({ sub: 'u', role: 'TAQUILLA', organizationId: 'org-a' }, 'org-b')).toBe(
      'org-a'
    );
  });

  it('403 para un usuario sin organización (nunca búsqueda global)', () => {
    expect(() => posOrgScope({ sub: 'u', role: 'TAQUILLA', organizationId: null })).toThrow(
      ForbiddenException
    );
    expect(() => posOrgScope(undefined)).toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN puede pedir otra org', () => {
    expect(posOrgScope({ sub: 'u', role: 'SUPER_ADMIN', organizationId: 'org-a' }, 'org-b')).toBe(
      'org-b'
    );
  });
});

describe('TaquillaPosService · alcance por organización', () => {
  function build() {
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(null) },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          publicId: 'ORD-1',
          status: 'COMPLETED',
          organizationId: 'org-b',
          posOps: {},
        }),
        update: jest.fn(),
      },
    };
    const service = new TaquillaPosService(prisma as never, {} as never, {} as never);
    return { service, prisma };
  }

  it('scan filtra boleto y orden por la organización', async () => {
    const { service, prisma } = build();
    await expect(service.scanBarcode('term', 'BLT-X', 'org-a')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.ticket.findFirst.mock.calls[0][0].where).toMatchObject({
      event: { organizationId: 'org-a' },
    });
    expect(prisma.order.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-a',
    });
  });

  it('will-call busca sólo en la organización dada', async () => {
    const { service, prisma } = build();
    await service.willcallLookup('ana', 'org-a');
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-a',
    });
  });

  it('no entrega una orden de otra organización', async () => {
    const { service, prisma } = build();
    await expect(service.willcallFulfill('o1', 'cajero', 'term', 'org-a')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('TaquillaPosService · venta entre organizaciones', () => {
  function build(terminalOrg: string, eventOrg: string) {
    const prisma = {
      posTerminal: { findUnique: jest.fn().mockResolvedValue({ organizationId: terminalOrg }) },
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: eventOrg }) },
    };
    const inventory = { createHold: jest.fn() };
    const orders = { createOrder: jest.fn() };
    const service = new TaquillaPosService(prisma as never, inventory as never, orders as never);
    const sell = (org?: string) =>
      service.quickCheckout(
        'term',
        'ses',
        { eventId: 'ev', offerId: 'of', quantity: 1, paymentMethod: 'CASH' },
        org
      );
    return { sell, inventory, orders };
  }

  it('403 si la función es de otra organización que la terminal', async () => {
    const { sell, inventory, orders } = build('org-arena', 'org-demo');
    await expect(sell('org-arena')).rejects.toBeInstanceOf(ForbiddenException);
    expect(inventory.createHold).not.toHaveBeenCalled();
    expect(orders.createOrder).not.toHaveBeenCalled();
  });

  it('403 si la terminal es de otra organización que el cajero', async () => {
    const { sell, inventory } = build('org-demo', 'org-demo');
    await expect(sell('org-arena')).rejects.toBeInstanceOf(ForbiddenException);
    expect(inventory.createHold).not.toHaveBeenCalled();
  });

  it('deja seguir cuando cajero, terminal y función coinciden', async () => {
    const { sell, inventory } = build('org-demo', 'org-demo');
    inventory.createHold.mockRejectedValue(new Error('stop-after-scope'));
    await expect(sell('org-demo')).rejects.toThrow('stop-after-scope');
    expect(inventory.createHold).toHaveBeenCalled();
  });
});

describe('TaquillaPosService · traspaso de turno', () => {
  function build(found: { id: string } | null) {
    const prisma = {
      posCashierSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ses',
          terminalId: 'term',
          terminal: { organizationId: 'org-a' },
        }),
      },
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-a', settings: {} }) },
      user: { findFirst: jest.fn().mockResolvedValue(found) },
    };
    const service = new TaquillaPosService(prisma as never, {} as never, {} as never);
    const end = jest.spyOn(service, 'endCashierSession').mockResolvedValue({
      expectedCash: 100,
    } as never);
    const start = jest
      .spyOn(service, 'startCashierSession')
      .mockResolvedValue({ sessionId: 'nueva' } as never);
    return { service, end, start, prisma };
  }

  it('no cierra el turno si el cajero entrante no existe', async () => {
    const { service, end } = build(null);
    await expect(
      service.handoff({
        sessionId: 'ses',
        fromCashierId: 'u1',
        toCashierId: 'nadie@x.mx',
        managerPin: '2468',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(end).not.toHaveBeenCalled();
  });

  it('abre el turno nuevo con el id del usuario aunque se escriba el correo', async () => {
    const { service, start, prisma } = build({ id: 'u2' });
    await service.handoff({
      sessionId: 'ses',
      fromCashierId: 'u1',
      toCashierId: 'Supervisor@Demo.mx',
      managerPin: '2468',
    });
    expect(prisma.user.findFirst.mock.calls[0][0].where.organizationId).toBe('org-a');
    expect(start).toHaveBeenCalledWith('term', 'u2', 100);
  });
});

describe('TaquillaPosService · cortesías en el corte', () => {
  it('cuenta las órdenes COURTESY del turno', async () => {
    const prisma = {
      posCashierSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ses',
          cashierId: 'u1',
          startedAt: new Date('2026-11-14T10:00:00Z'),
          metadata: { openingCash: 0 },
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'o1',
            publicId: 'ORD-1',
            totalAmount: 0,
            paymentMethod: 'CASH',
            posOps: { isComp: true },
            createdAt: new Date(),
            event: { title: 'X' },
            items: [{ quantity: 1 }],
          },
        ]),
      },
    };
    const service = new TaquillaPosService(prisma as never, {} as never, {} as never);
    const summary = await service.getSessionSummary('ses');
    expect(prisma.order.findMany.mock.calls[0][0].where.channel).toEqual({
      in: ['TAQUILLA', 'COURTESY'],
    });
    expect(summary.compCount).toBe(1);
    expect(summary.cashVariancePinThreshold).toBe(50);
    expect(summary.cashSales).toBe(0);
  });
});
