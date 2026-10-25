import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class SeasonService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(
    orgId: string,
    data: {
      name: string;
      slug: string;
      description?: string;
      seasonLabel: string;
      startsAt: string;
      endsAt: string;
      price: number;
      venueId?: string;
      maxQuantity?: number;
      eventIds?: string[];
    },
  ) {
    const pass = await this.prisma.seasonPass.create({
      data: {
        organizationId: orgId,
        venueId: data.venueId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        seasonLabel: data.seasonLabel,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        price: data.price,
        maxQuantity: data.maxQuantity ?? 100,
        events: data.eventIds?.length
          ? { create: data.eventIds.map((eventId) => ({ eventId })) }
          : undefined,
      },
      include: { events: true },
    });

    await this.audit.log({
      action: 'SEASON_PASS_CREATED',
      entityType: 'SeasonPass',
      entityId: pass.id,
      organizationId: orgId,
    });

    return pass;
  }

  async list(orgId: string) {
    return this.prisma.seasonPass.findMany({
      where: { organizationId: orgId },
      include: {
        events: { include: { event: { select: { id: true, title: true, startsAt: true } } } },
        _count: { select: { purchases: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async update(orgId: string, passId: string, body: SeasonPassWrite, actorId?: string) {
    const pass = await this.prisma.seasonPass.findFirst({
      where: { id: passId, organizationId: orgId },
    });
    if (!pass) throw new NotFoundException('Abono no encontrado');

    const data: Prisma.SeasonPassUpdateInput = {};
    if (body.name !== undefined) data.name = requiredText(body.name, 'Nombre del abono');
    if (body.slug !== undefined) data.slug = requiredText(body.slug, 'Slug del abono');
    if (body.description !== undefined) data.description = optionalText(body.description, 'Descripción del abono');
    if (body.seasonLabel !== undefined) data.seasonLabel = requiredText(body.seasonLabel, 'Temporada');
    if (body.price !== undefined) data.price = readMoney(body.price);
    if (body.currency !== undefined) {
      if (!isCurrency(body.currency)) throw new BadRequestException('Moneda del abono no reconocida');
      data.currency = body.currency;
    }
    if (body.maxQuantity !== undefined) {
      const maxQuantity = requiredInt(body.maxQuantity, 'Cupo del abono', 0);
      if (maxQuantity < pass.soldQuantity) {
        throw new BadRequestException('El cupo no puede quedar debajo de los abonos vendidos');
      }
      data.maxQuantity = maxQuantity;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw new BadRequestException('Abono activo no es un interruptor');
      data.active = body.active;
    }
    if (body.benefits !== undefined) data.benefits = readBenefits(body.benefits);
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      const startsAt = body.startsAt !== undefined ? readInstant(body.startsAt, 'Abono desde') : pass.startsAt;
      const endsAt = body.endsAt !== undefined ? readInstant(body.endsAt, 'Abono hasta') : pass.endsAt;
      if (endsAt.getTime() <= startsAt.getTime()) {
        throw new BadRequestException('El abono termina antes de empezar');
      }
      data.startsAt = startsAt;
      data.endsAt = endsAt;
    }

    const eventIds = body.eventIds === undefined ? undefined : readEventIds(body.eventIds);
    if (eventIds && eventIds.length > 0) {
      const found = await this.prisma.event.count({
        where: { organizationId: orgId, id: { in: eventIds } },
      });
      if (found !== eventIds.length) {
        throw new BadRequestException('Hay una función que no es de esta organización');
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.seasonPass.update({ where: { id: passId }, data });
        if (eventIds) {
          await tx.seasonPassEvent.deleteMany({ where: { seasonPassId: passId } });
          if (eventIds.length > 0) {
            await tx.seasonPassEvent.createMany({
              data: eventIds.map((eventId) => ({ seasonPassId: passId, eventId })),
            });
          }
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya hay un abono con ese slug');
      }
      throw error;
    }

    await this.audit.log({
      action: 'SEASON_PASS_UPDATED',
      entityType: 'SeasonPass',
      entityId: passId,
      organizationId: orgId,
      userId: actorId,
    });

    return this.prisma.seasonPass.findFirst({
      where: { id: passId },
      include: {
        events: { include: { event: { select: { id: true, title: true, startsAt: true } } } },
        _count: { select: { purchases: true } },
      },
    });
  }

  async purchase(
    seasonPassId: string,
    data: { buyerEmail: string; buyerName: string; quantity?: number; seatSection?: string },
  ) {
    const pass = await this.prisma.seasonPass.findUnique({ where: { id: seasonPassId } });
    if (!pass?.active) throw new NotFoundException('Season pass not found');
    const qty = data.quantity ?? 1;
    if (pass.soldQuantity + qty > pass.maxQuantity) {
      throw new BadRequestException('Season pass sold out');
    }

    const purchase = await this.prisma.$transaction(async (tx) => {
      await tx.seasonPass.update({
        where: { id: seasonPassId },
        data: { soldQuantity: { increment: qty } },
      });
      return tx.seasonPassPurchase.create({
        data: {
          seasonPassId,
          buyerEmail: data.buyerEmail.toLowerCase(),
          buyerName: data.buyerName,
          quantity: qty,
          totalAmount: Number(pass.price) * qty,
          status: 'COMPLETED',
          seatSection: data.seatSection,
        },
      });
    });

    return purchase;
  }
}

export type SeasonPassWrite = {
  name?: string;
  slug?: string;
  description?: string | null;
  seasonLabel?: string;
  startsAt?: string;
  endsAt?: string;
  price?: number;
  currency?: string;
  maxQuantity?: number;
  benefits?: unknown;
  active?: boolean;
  eventIds?: string[];
};

const CURRENCIES = new Set<string>(Object.values(Currency));

function isCurrency(value: string): value is Currency {
  return CURRENCIES.has(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} no puede quedar vacío`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} no es texto`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requiredInt(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new BadRequestException(`${field} tiene que ser un entero desde ${min}`);
  }
  return value;
}

function readMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) {
    throw new BadRequestException('Precio del abono no es válido');
  }
  return Math.round(value * 100) / 100;
}

function readInstant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${field} no es una fecha`);
  }
  return new Date(value);
}

function readBenefits(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return Prisma.DbNull;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as Prisma.InputJsonValue;
      } catch {
        throw new BadRequestException('Beneficios no son JSON válido');
      }
    }
    return trimmed;
  }
  if (typeof value === 'object') return value as Prisma.InputJsonValue;
  throw new BadRequestException('Beneficios no se pueden guardar');
}

function readEventIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new BadRequestException('Eventos del abono no es una lista');
  }
  return [...new Set(value)];
}
