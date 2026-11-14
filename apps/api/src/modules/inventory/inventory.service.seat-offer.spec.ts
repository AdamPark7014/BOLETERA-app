import { BadRequestException } from '@nestjs/common';
import { SalesChannel } from '@prisma/client';
import { InventoryService } from './inventory.service';

/**
 * La zona (oferta) de un asiento numerado la decide su boleto, no el request.
 * Antes, taquilla podía apartar Luneta A-3 con el offerId de Balcón y la orden
 * cobraba el precio barato.
 */
describe('InventoryService · asiento numerado y su oferta', () => {
  function build(ticketOfferId: string) {
    const created: Array<{ offerId: string }> = [];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 't1', offerId: ticketOfferId }]),
      seatHold: {
        create: jest.fn(async ({ data }: { data: { offerId: string } }) => {
          created.push(data);
          return { id: 'h1', seatId: 's1', ...data };
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue('ACQUIRED'),
      releaseLock: jest.fn().mockResolvedValue(true),
      setJson: jest.fn().mockResolvedValue(true),
    };
    const service = new InventoryService(
      prisma as never,
      redis as never,
      {} as never,
      {} as never,
      {} as never
    );
    const hold = (offerId?: string) =>
      (
        service as unknown as {
          createReservedSeatHold: (...args: unknown[]) => Promise<unknown>;
        }
      ).createReservedSeatHold(
        { eventId: 'e1', offerId, sessionId: 'ses' },
        ['s1'],
        SalesChannel.TAQUILLA,
        300,
        new Date(Date.now() + 300_000)
      );
    return { hold, created, redis };
  }

  it('rechaza un offerId que no es la zona del asiento y suelta el candado', async () => {
    const { hold, created, redis } = build('offer-luneta');
    await expect(hold('offer-balcon')).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
    expect(redis.releaseLock).toHaveBeenCalled();
  });

  it('con la zona correcta, o sin offerId, el hold lleva la oferta del boleto', async () => {
    const ok = build('offer-luneta');
    await ok.hold('offer-luneta');
    expect(ok.created[0].offerId).toBe('offer-luneta');

    const sinOferta = build('offer-luneta');
    await sinOferta.hold(undefined);
    expect(sinOferta.created[0].offerId).toBe('offer-luneta');
  });
});
