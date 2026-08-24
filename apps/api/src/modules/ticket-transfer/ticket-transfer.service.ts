import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class TicketTransferService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationService,
  ) {}

  private generateCode() {
    return `TRF-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  async initiate(data: {
    ticketId: string;
    fromUserId: string;
    toEmail: string;
    message?: string;
  }) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: data.ticketId },
      include: {
        event: { select: { id: true, title: true, transferAllowed: true, organizationId: true } },
        orderItem: { include: { order: { select: { userId: true } } } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.SOLD) {
      throw new BadRequestException('Solo se pueden transferir boletos activos');
    }
    if (!ticket.event.transferAllowed) {
      throw new BadRequestException('Este evento no permite transferencias');
    }

    const ownerId = ticket.orderItem?.order?.userId;
    if (ownerId && ownerId !== data.fromUserId) {
      throw new UnauthorizedException('No eres el dueño de este boleto');
    }

    // UNA sola transferencia pendiente por boleto.
    //
    // Sin esto se podia regalar el mismo boleto a dos personas a la vez: ambas
    // recibian su codigo, ambas lo aceptaban, y la segunda descubria en la
    // puerta que su entrada era de otro. El indice unico parcial de la
    // migracion lo garantiza tambien bajo concurrencia; esta comprobacion
    // existe para dar un mensaje util en vez de un choque de indice.
    const pendiente = await this.prisma.ticketTransfer.findFirst({
      where: {
        ticketId: data.ticketId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { toEmail: true },
    });
    if (pendiente) {
      throw new BadRequestException(
        `Este boleto ya está ofrecido a ${pendiente.toEmail}. ` +
          'Cancela esa transferencia antes de enviarlo a otra persona.',
      );
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const transfer = await this.prisma.ticketTransfer.create({
      data: {
        ticketId: data.ticketId,
        fromUserId: data.fromUserId,
        toEmail: data.toEmail.toLowerCase(),
        transferCode: this.generateCode(),
        message: data.message,
        expiresAt,
      },
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    await this.notifications.enqueueEmail({
      to: data.toEmail,
      subject: `Te transfirieron un boleto — ${ticket.event.title}`,
      template: 'ticket-transfer',
      data: {
        eventTitle: ticket.event.title,
        transferCode: transfer.transferCode,
        acceptUrl: `${webUrl}/cuenta?transfer=${transfer.transferCode}`,
        message: data.message,
      },
    });

    await this.audit.log({
      action: 'TICKET_TRANSFER_INITIATED',
      entityType: 'TicketTransfer',
      entityId: transfer.id,
      organizationId: ticket.event.organizationId,
      userId: data.fromUserId,
      metadata: { ticketId: data.ticketId, toEmail: data.toEmail },
    });

    return transfer;
  }

  async accept(transferCode: string, toUserId: string) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { transferCode },
      include: { ticket: { include: { event: true } } },
    });

    if (!transfer) throw new NotFoundException('Transferencia no encontrada');
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('Esta transferencia ya fue procesada');
    }
    if (transfer.expiresAt < new Date()) {
      await this.prisma.ticketTransfer.update({
        where: { id: transfer.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('La transferencia expiró');
    }

    const user = await this.prisma.user.findUnique({ where: { id: toUserId } });
    if (!user || user.email.toLowerCase() !== transfer.toEmail) {
      throw new UnauthorizedException('El email de tu cuenta no coincide con la transferencia');
    }

    await this.prisma.$transaction([
      this.prisma.ticketTransfer.update({
        where: { id: transfer.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), toUserId },
      }),
      this.prisma.ticket.update({
        where: { id: transfer.ticketId },
        data: {
          status: TicketStatus.SOLD,
          buyerEmail: user.email,
          buyerName: `${user.firstName} ${user.lastName}`,
          // Invalida la clave que el telefono de quien lo regalo ya tiene
          // descargada. Sin esto el QR sigue siendo valido para el, entran los
          // dos, y el segundo se queda fuera sin entender por que.
          keyEpoch: { increment: 1 },
        },
      }),
      // Cualquier otra oferta viva de ESTE boleto queda sin efecto: quien lo
      // recibio ya es el dueño y nadie mas debe poder reclamarlo.
      this.prisma.ticketTransfer.updateMany({
        where: { ticketId: transfer.ticketId, status: 'PENDING', id: { not: transfer.id } },
        data: { status: 'CANCELLED' },
      }),
    ]);

    await this.audit.log({
      action: 'TICKET_TRANSFER_ACCEPTED',
      entityType: 'TicketTransfer',
      entityId: transfer.id,
      organizationId: transfer.ticket.event.organizationId,
      userId: toUserId,
    });

    return { ok: true, ticket: transfer.ticket };
  }

  async listByUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const [sent, received] = await Promise.all([
      this.prisma.ticketTransfer.findMany({
        where: { fromUserId: userId },
        include: { ticket: { include: { event: { select: { title: true, startsAt: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.ticketTransfer.findMany({
        where: { toEmail: user.email.toLowerCase() },
        include: { ticket: { include: { event: { select: { title: true, startsAt: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return { sent, received };
  }

  async cancel(transferId: string, userId: string) {
    const transfer = await this.prisma.ticketTransfer.findFirst({
      where: { id: transferId, fromUserId: userId, status: 'PENDING' },
    });
    if (!transfer) throw new NotFoundException('Transferencia no encontrada');

    return this.prisma.ticketTransfer.update({
      where: { id: transferId },
      data: { status: 'CANCELLED' },
    });
  }
}



