import { TaquillaPosService } from './taquilla-pos.service';

/**
 * Pago mixto: las partes viven en Order.posOps (no hay enum MIXED en Prisma).
 * El corte Z suma por método desde paymentParts cuando existen.
 */
describe('TaquillaPosService · pago mixto', () => {
  function buildCheckout() {
    const prisma = {
      posTerminal: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      seatHold: { findMany: jest.fn() },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    const inventory = {
      createHold: jest.fn().mockResolvedValue({
        holds: [{ id: 'h1' }],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const orders = {
      createOrder: jest.fn().mockResolvedValue({
        id: 'ord-1',
        publicId: 'ORD-1',
        totalAmount: 150,
        subtotal: 150,
        fees: 0,
        taxAmount: 0,
        status: 'COMPLETED',
      }),
    };
    const service = new TaquillaPosService(prisma as never, inventory as never, orders as never);
    return { service, orders, inventory };
  }

  it('guarda paymentParts y mixed en posOps y responde MIXED', async () => {
    const { service, orders } = buildCheckout();
    const result = await service.quickCheckout(
      'term',
      'ses',
      {
        eventId: 'ev',
        offerId: 'of',
        quantity: 1,
        paymentMethod: 'CASH',
        paymentParts: [
          { method: 'CASH', amount: 100 },
          { method: 'CARD', amount: 50 },
        ],
        cashReceived: 100,
        changeGiven: 0,
      },
      'org-demo'
    );

    expect(result.paymentMethod).toBe('MIXED');
    expect(result.paymentParts).toEqual([
      { method: 'CASH', amount: 100 },
      { method: 'CARD', amount: 50 },
    ]);
    expect(orders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: 'CASH',
        posOps: expect.objectContaining({
          mixed: true,
          paymentParts: [
            { method: 'CASH', amount: 100 },
            { method: 'CARD', amount: 50 },
          ],
          cashReceived: 100,
          changeGiven: 0,
        }),
      })
    );
  });

  it('el corte Z suma por partes, no el total en un solo método', async () => {
    const prisma = {
      posCashierSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ses',
          cashierId: 'cajero-1',
          startedAt: new Date('2026-11-17T10:00:00Z'),
          metadata: { openingCash: 500 },
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ord-1',
            publicId: 'ORD-1',
            paymentMethod: 'CASH',
            totalAmount: 150,
            createdAt: new Date('2026-11-17T11:00:00Z'),
            posOps: {
              paymentParts: [
                { method: 'CASH', amount: 100 },
                { method: 'CARD', amount: 50 },
              ],
            },
            event: { title: 'Final Regional' },
            items: [{ quantity: 2 }],
          },
        ]),
      },
    };
    const service = new TaquillaPosService(prisma as never, {} as never, {} as never);
    const summary = await service.getSessionSummary('ses');
    expect(summary.cashSales).toBe(100);
    expect(summary.cardSales).toBe(50);
    expect(summary.byMethod).toEqual({ CASH: 100, CARD: 50 });
    expect(summary.expectedCash).toBe(600);
  });

  it('el recibo muestra MIXED y el desglose guardado en posOps', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-1',
          publicId: 'ORD-1',
          organizationId: 'org-demo',
          paymentMethod: 'CASH',
          subtotal: 150,
          fees: 0,
          taxAmount: 0,
          totalAmount: 150,
          completedAt: new Date('2026-11-17T12:00:00Z'),
          createdAt: new Date('2026-11-17T12:00:00Z'),
          posOps: {
            mixed: true,
            paymentParts: [
              { method: 'CASH', amount: 100 },
              { method: 'CARD', amount: 50 },
            ],
            cashReceived: 200,
            changeGiven: 100,
          },
          event: { title: 'Final Regional' },
          items: [
            {
              quantity: 2,
              tickets: [{ code: 'T-1', section: 'GA', row: null, seatNumber: null }],
            },
          ],
        }),
      },
    };
    const service = new TaquillaPosService(prisma as never, {} as never, {} as never);
    const receipt = await service.generateReceipt('ord-1', 'term', 'org-demo');
    expect(receipt.paymentMethod).toBe('MIXED');
    expect(receipt.paymentParts).toEqual([
      { method: 'CASH', amount: 100 },
      { method: 'CARD', amount: 50 },
    ]);
    expect(receipt.cashReceived).toBe(200);
    expect(receipt.changeGiven).toBe(100);
  });
  it('rechaza partes mixtas que no suman el total y aborta la orden', async () => {
    const prisma = {
      posTerminal: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      seatHold: { findMany: jest.fn() },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-1',
          publicId: 'ORD-1',
          items: [{ quantity: 1, offerId: 'of', tickets: [{ id: 't1' }] }],
        }),
        update: jest.fn(),
      },
      ticket: { update: jest.fn() },
      offer: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: {
        order: { update: jest.Mock };
        ticket: { update: jest.Mock };
        offer: { update: jest.Mock };
      }) => Promise<unknown>) =>
        fn({
          order: { update: jest.fn() },
          ticket: { update: jest.fn() },
          offer: { update: jest.fn() },
        })
      ),
    };
    const inventory = {
      createHold: jest.fn().mockResolvedValue({
        holds: [{ id: 'h1' }],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const orders = {
      createOrder: jest.fn().mockResolvedValue({
        id: 'ord-1',
        publicId: 'ORD-1',
        totalAmount: 150,
        subtotal: 150,
        fees: 0,
        taxAmount: 0,
        status: 'COMPLETED',
      }),
    };
    const service = new TaquillaPosService(prisma as never, inventory as never, orders as never);
    await expect(
      service.quickCheckout(
        'term',
        'ses',
        {
          eventId: 'ev',
          offerId: 'of',
          quantity: 1,
          paymentMethod: 'CASH',
          paymentParts: [
            { method: 'CASH', amount: 40 },
            { method: 'CARD', amount: 50 },
          ],
        },
        'org-demo'
      )
    ).rejects.toThrow(/no suman el total/);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('corrige una sola parte si el importe no coincide con el total', async () => {
    const prisma = {
      posTerminal: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-demo' }) },
      seatHold: { findMany: jest.fn() },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    const inventory = {
      createHold: jest.fn().mockResolvedValue({
        holds: [{ id: 'h1' }],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const orders = {
      createOrder: jest.fn().mockResolvedValue({
        id: 'ord-1',
        publicId: 'ORD-1',
        totalAmount: 150,
        subtotal: 150,
        fees: 0,
        taxAmount: 0,
        status: 'COMPLETED',
        posOps: {},
      }),
    };
    const service = new TaquillaPosService(prisma as never, inventory as never, orders as never);
    const result = await service.quickCheckout(
      'term',
      'ses',
      {
        eventId: 'ev',
        offerId: 'of',
        quantity: 1,
        paymentMethod: 'CASH',
        paymentParts: [{ method: 'CASH', amount: 99 }],
      },
      'org-demo'
    );
    expect(result.paymentParts).toEqual([{ method: 'CASH', amount: 150 }]);
    expect(prisma.order.update).toHaveBeenCalled();
  });
});
