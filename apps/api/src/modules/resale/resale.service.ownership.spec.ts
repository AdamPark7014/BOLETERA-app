import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ResaleOfferStatus, ResaleStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ResaleService } from './resale.service';

/**
 * Reventa: solo el dueño publica y solo el vendedor acepta, rechaza o cancela.
 * Antes cualquiera con sesión podía publicar un boleto ajeno por su código,
 * ofertar $1 y aceptarse la oferta.
 */
describe('ResaleService · dueño del boleto y del anuncio', () => {
  const ticket = {
    id: 't1',
    status: 'SOLD',
    orderItemId: 'oi1',
    buyerEmail: 'Duena@Ejemplo.mx',
    orderItem: { order: { userId: 'u-duena' } },
    offer: { basePrice: new Decimal(500) },
    event: { allowResale: true, organization: { resaleCommission: null } },
  };

  function build() {
    const ticketUpdate = jest.fn().mockResolvedValue({ id: 't1' });
    const tx = {
      resaleOffer: { update: jest.fn() },
      resaleListing: { update: jest.fn() },
      ticket: { update: ticketUpdate },
      order: { create: jest.fn().mockResolvedValue({ id: 'o1' }) },
    };
    const prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue(ticket),
        findFirst: jest.fn().mockResolvedValue(ticket),
        update: jest.fn(),
      },
      resaleListing: {
        create: jest.fn().mockResolvedValue({ id: 'l1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      resaleOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'of1',
          listingId: 'l1',
          status: ResaleOfferStatus.PENDING,
          buyerId: 'u-otro',
          buyerEmail: 'otro@ejemplo.mx',
          offerPrice: new Decimal(1),
          listing: {
            sellerId: 'u-duena',
            status: ResaleStatus.ACTIVE,
            ticketId: 't1',
            fee: new Decimal(0),
            currency: 'MXN',
            ticket: { eventId: 'e1', event: { organizationId: 'org1' } },
          },
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      ticketTransfer: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { service: new ResaleService(prisma as never), prisma, ticketUpdate };
  }

  it('un tercero no puede publicar un boleto ajeno por su código', async () => {
    const { service, prisma } = build();
    await expect(
      service.createListing({
        ticketCode: 'BLT-1',
        askingPrice: 500,
        sellerId: 'u-otro',
        sellerEmail: 'otro@ejemplo.mx',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.resaleListing.create).not.toHaveBeenCalled();
  });

  it('la dueña publica (por cuenta o por correo sin importar mayúsculas)', async () => {
    const { service, prisma } = build();
    await service.createListing({ ticketId: 't1', askingPrice: 500, sellerId: 'u-duena' });
    await service.createListing({
      ticketId: 't1',
      askingPrice: 500,
      sellerId: 'u-invitada',
      sellerEmail: 'duena@ejemplo.mx',
    });
    expect(prisma.resaleListing.create).toHaveBeenCalledTimes(2);
  });

  it('solo el vendedor acepta; al aceptar el QR anterior deja de valer', async () => {
    const { service, ticketUpdate } = build();
    await expect(service.acceptOffer('of1', 'u-otro')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ticketUpdate).not.toHaveBeenCalled();

    await service.acceptOffer('of1', 'u-duena');
    const data = ticketUpdate.mock.calls[0][0].data;
    expect(data.keyEpoch).toEqual({ increment: 1 });
    expect(typeof data.code).toBe('string');
  });

  it('solo el vendedor rechaza o cancela, y nadie oferta por lo suyo', async () => {
    const { service, prisma } = build();
    prisma.resaleOffer.findUnique.mockResolvedValueOnce({
      id: 'of1',
      listing: { sellerId: 'u-duena' },
    });
    await expect(service.rejectOffer('of1', 'u-otro')).rejects.toBeInstanceOf(ForbiddenException);

    prisma.resaleListing.findUnique.mockResolvedValueOnce({
      id: 'l1',
      sellerId: 'u-duena',
      status: ResaleStatus.ACTIVE,
      ticketId: 't1',
    });
    await expect(service.cancelListing('l1', 'u-otro')).rejects.toBeInstanceOf(ForbiddenException);

    prisma.resaleListing.findUnique.mockResolvedValueOnce({
      id: 'l1',
      sellerId: 'u-duena',
      status: ResaleStatus.ACTIVE,
      askingPrice: new Decimal(500),
    });
    await expect(
      service.makeOffer({
        listingId: 'l1',
        offerPrice: 1,
        buyerId: 'u-duena',
        buyerEmail: 'duena@ejemplo.mx',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
