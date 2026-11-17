import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotificationService } from '../notification/notification.service';

/** Apartado de lista de espera estilo DICE: 60 minutos a precio original. */
export const CLAIM_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class WaitlistService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationService
  ) {}

  async join(data: {
    eventId: string;
    email: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    quantity?: number;
    offerId?: string;
  }) {
    const event = await this.prisma.event.findUnique({
      where: { id: data.eventId },
      select: { id: true, title: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('No encontramos ese evento');

    try {
      const entry = await this.prisma.waitlistEntry.create({
        data: {
          eventId: data.eventId,
          email: data.email.toLowerCase(),
          phone: data.phone,
          firstName: data.firstName,
          lastName: data.lastName,
          quantity: data.quantity ?? 1,
          offerId: data.offerId,
        },
      });

      await this.audit.log({
        action: 'WAITLIST_JOIN',
        entityType: 'WaitlistEntry',
        entityId: entry.id,
        organizationId: event.organizationId,
        metadata: { eventId: data.eventId, email: data.email },
      });

      return { ...entry, message: 'Te avisaremos cuando haya disponibilidad.' };
    } catch {
      throw new ConflictException('Ya estás en la lista de espera para este evento');
    }
  }

  async listByEvent(eventId: string, status?: string) {
    return this.prisma.waitlistEntry.findMany({
      where: {
        eventId,
        ...(status ? { status: status as 'PENDING' | 'NOTIFIED' | 'CONVERTED' } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async listByOrganization(orgId: string) {
    return this.prisma.waitlistEntry.findMany({
      where: { event: { organizationId: orgId } },
      include: {
        event: { select: { id: true, title: true, slug: true, startsAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Ofrece el boleto liberado al primero de la cola (uno a la vez).
   * Si ya hay un claim vigente, no abre otro.
   */
  async offerNext(
    eventId: string,
    opts?: {
      ticketId?: string;
      offerId?: string;
      facePrice?: number;
      holdId?: string;
      source?: string;
    }
  ) {
    const active = await this.prisma.waitlistEntry.findFirst({
      where: {
        eventId,
        status: 'NOTIFIED',
        claimExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (active) return null;

    const pending = await this.prisma.waitlistEntry.findFirst({
      where: { eventId, status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (!pending) return null;

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, slug: true, organizationId: true },
    });
    if (!event) return null;

    const claimToken = randomBytes(24).toString('hex');
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_TTL_MS);

    const entry = await this.prisma.waitlistEntry.update({
      where: { id: pending.id },
      data: {
        status: 'NOTIFIED',
        notifiedAt: now,
        claimToken,
        claimExpiresAt,
        reservedTicketId: opts?.ticketId ?? null,
        reservedHoldId: opts?.holdId ?? null,
        offerId: opts?.offerId ?? pending.offerId,
        facePrice:
          opts?.facePrice != null && Number.isFinite(opts.facePrice)
            ? new Decimal(opts.facePrice)
            : null,
      },
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const claimUrl = `${webUrl}/espera/${claimToken}`;

    await this.notifications.enqueueEmail({
      to: entry.email,
      subject: `Hay boleto para ti — ${event.title}`,
      template: 'waitlist-available',
      data: {
        eventTitle: event.title,
        eventUrl: `${webUrl}/events/${event.slug}`,
        claimUrl,
        quantity: entry.quantity,
        expiresAt: claimExpiresAt.toISOString(),
        facePrice: opts?.facePrice ?? null,
      },
    });

    await this.audit.log({
      action: 'WAITLIST_OFFER',
      entityType: 'WaitlistEntry',
      entityId: entry.id,
      organizationId: event.organizationId,
      metadata: {
        eventId,
        source: opts?.source ?? 'offerNext',
        claimExpiresAt: claimExpiresAt.toISOString(),
      },
    });

    return entry;
  }

  async getByClaimToken(token: string) {
    const raw = token?.trim();
    if (!raw) throw new NotFoundException('No encontramos ese enlace de espera');

    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { claimToken: raw },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startsAt: true,
            organizationId: true,
            image: true,
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('No encontramos ese enlace de espera');

    if (entry.status !== 'NOTIFIED' || !entry.claimExpiresAt) {
      throw new BadRequestException('Este enlace de espera ya no está activo');
    }
    if (entry.claimExpiresAt.getTime() <= Date.now()) {
      await this.expireClaim(entry.id);
      throw new BadRequestException('El enlace de espera venció');
    }

    const email = entry.email;
    const at = email.indexOf('@');
    const maskedEmail =
      at > 1 ? `${email[0]}${'•'.repeat(Math.min(at - 1, 6))}${email.slice(at)}` : email;

    return {
      id: entry.id,
      status: entry.status,
      quantity: entry.quantity,
      offerId: entry.offerId,
      reservedTicketId: entry.reservedTicketId,
      facePrice: entry.facePrice != null ? Number(entry.facePrice) : null,
      claimExpiresAt: entry.claimExpiresAt.toISOString(),
      email: maskedEmail,
      event: entry.event,
    };
  }

  async expireClaim(entryId: string) {
    const current = await this.prisma.waitlistEntry.findUnique({
      where: { id: entryId },
      select: { id: true, eventId: true, status: true },
    });
    if (!current) return { expired: false };

    if (current.status === 'NOTIFIED') {
      await this.prisma.waitlistEntry.update({
        where: { id: entryId },
        data: {
          status: 'EXPIRED',
          claimToken: null,
          claimExpiresAt: null,
          reservedTicketId: null,
          reservedHoldId: null,
          facePrice: null,
        },
      });
    }

    await this.offerNext(current.eventId, { source: 'expireClaim' });
    return { expired: true };
  }

  async convertClaim(token: string) {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { claimToken: token.trim() },
    });
    if (!entry) throw new NotFoundException('No encontramos ese enlace de espera');
    if (entry.status !== 'NOTIFIED' || !entry.claimExpiresAt) {
      throw new BadRequestException('Este enlace de espera ya no está activo');
    }
    if (entry.claimExpiresAt.getTime() <= Date.now()) {
      await this.expireClaim(entry.id);
      throw new BadRequestException('El enlace de espera venció');
    }

    return this.prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: 'CONVERTED',
        convertedAt: new Date(),
        claimToken: null,
      },
    });
  }

  /** Estilo DICE: solo el primero de la cola recibe el enlace. */
  async notifyBatch(eventId: string, _limit = 50, actorId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('No encontramos ese evento');

    const offered = await this.offerNext(eventId, { source: 'notifyBatch' });

    await this.audit.log({
      action: 'WAITLIST_NOTIFY_BATCH',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: actorId,
      metadata: { notified: offered ? 1 : 0 },
    });

    return { notified: offered ? 1 : 0, total: offered ? 1 : 0 };
  }

  async stats(eventId: string) {
    const grouped = await this.prisma.waitlistEntry.groupBy({
      by: ['status'],
      where: { eventId },
      _count: true,
    });
    const total = grouped.reduce((s, g) => s + g._count, 0);
    return { total, byStatus: grouped };
  }
}
