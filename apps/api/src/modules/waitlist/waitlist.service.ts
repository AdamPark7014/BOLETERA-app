import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotificationService } from '../notification/notification.service';

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
      select: { id: true, title: true, organizationId: true, status: true },
    });
    if (!event) throw new NotFoundException('Event not found');

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

  async notifyBatch(eventId: string, limit = 50, actorId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { offers: { where: { isAvailable: true, remainingQuantity: { gt: 0 } } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    const entries = await this.prisma.waitlistEntry.findMany({
      where: { eventId, status: 'PENDING' },
      take: limit,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    let notified = 0;

    for (const entry of entries) {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'NOTIFIED', notifiedAt: new Date() },
      });

      await this.notifications.enqueueEmail({
        to: entry.email,
        subject: `¡Boletos disponibles! — ${event.title}`,
        template: 'waitlist-available',
        data: {
          eventTitle: event.title,
          eventUrl: `${webUrl}/events/${event.slug}`,
          quantity: entry.quantity,
        },
      });
      notified++;
    }

    await this.audit.log({
      action: 'WAITLIST_NOTIFY_BATCH',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: actorId,
      metadata: { notified },
    });

    return { notified, total: entries.length };
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
