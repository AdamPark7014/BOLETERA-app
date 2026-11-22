import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PurchaseLimits = {
  maxPerAccount: number;
  maxPerEmail: number;
  maxPerCard: number;
};

type AssertArgs = {
  eventId: string;
  quantity: number;
  userId?: string;
  email?: string;
  cardLast4?: string | null;
};

/** Tope de boletos por comprador y evento (cuenta, correo, tarjeta). */
@Injectable()
export class PurchaseLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLimits(eventId: string): Promise<PurchaseLimits> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    const raw = (event?.metadata as Record<string, unknown> | null)?.purchaseLimits as
      | Partial<PurchaseLimits>
      | undefined;

    if (!raw || typeof raw !== 'object') {
      return { maxPerAccount: 50, maxPerEmail: 50, maxPerCard: 50 };
    }

    const num = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    };

    return {
      maxPerAccount: num(raw.maxPerAccount, 8),
      maxPerEmail: num(raw.maxPerEmail, 8),
      maxPerCard: num(raw.maxPerCard, 8),
    };
  }

  async assertCanBuy(args: AssertArgs): Promise<void> {
    const limits = await this.getLimits(args.eventId);
    const qty = Math.max(1, Math.floor(args.quantity));

    if (args.userId) {
      const owned = await this.prisma.orderItem.aggregate({
        where: {
          order: {
            eventId: args.eventId,
            userId: args.userId,
            status: OrderStatus.COMPLETED,
          },
        },
        _sum: { quantity: true },
      });
      const have = owned._sum.quantity ?? 0;
      if (have + qty > limits.maxPerAccount) {
        throw new BadRequestException(
          `Alcanzaste el máximo de ${limits.maxPerAccount} boletos por cuenta en este evento.`
        );
      }
    }

    const email = args.email?.trim().toLowerCase();
    if (email) {
      const owned = await this.prisma.orderItem.aggregate({
        where: {
          order: {
            eventId: args.eventId,
            buyerEmail: { equals: email, mode: 'insensitive' },
            status: OrderStatus.COMPLETED,
          },
        },
        _sum: { quantity: true },
      });
      const have = owned._sum.quantity ?? 0;
      if (have + qty > limits.maxPerEmail) {
        throw new BadRequestException(
          `Alcanzaste el máximo de ${limits.maxPerEmail} boletos por correo en este evento.`
        );
      }
    }

    const last4 = args.cardLast4?.replace(/\D/g, '').slice(-4);
    if (last4 && last4.length === 4) {
      const owned = await this.prisma.orderItem.aggregate({
        where: {
          order: {
            eventId: args.eventId,
            status: OrderStatus.COMPLETED,
            payment: {
              status: PaymentStatus.COMPLETED,
              lastFourDigits: last4,
            },
          },
        },
        _sum: { quantity: true },
      });
      const have = owned._sum.quantity ?? 0;
      if (have + qty > limits.maxPerCard) {
        throw new BadRequestException(
          `Alcanzaste el máximo de ${limits.maxPerCard} boletos por tarjeta en este evento.`
        );
      }
    }
  }
}
