import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { checkClabe, maskClabe } from '../orders/clabe';
import { PrismaService } from '../prisma/prisma.service';

export type SellerPayoutFilters = {
  status?: 'PENDING' | 'PAID' | string;
  from?: string;
  to?: string;
};

/**
 * Pagos a vendedores de reventa: listar pendientes, marcar pagado (SPEI) y
 * exportar CSV. El vendedor captura CLABE desde «Mis ventas».
 */
@Injectable()
export class ResaleSellerPayoutService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  async list(orgId: string, filters: SellerPayoutFilters = {}) {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      status: OrderStatus.COMPLETED,
    };
    if (filters.status === 'PENDING' || filters.status === 'PAID') {
      where.payoutStatus = filters.status;
    }
    if (filters.from || filters.to) {
      where.completedAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    const rows = await this.prisma.resaleCheckout.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      take: 200,
      include: {
        listing: {
          include: {
            ticket: { include: { event: { select: { id: true, title: true, slug: true } } } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      publicId: r.publicId,
      sellerPayout: r.sellerPayout.toString(),
      fee: r.fee.toString(),
      currency: r.currency,
      payoutStatus: r.payoutStatus,
      sellerClabe: maskClabe(r.sellerClabe),
      payoutReference: r.payoutReference,
      payoutPaidAt: r.payoutPaidAt?.toISOString() ?? null,
      payoutPaidById: r.payoutPaidById,
      completedAt: r.completedAt?.toISOString() ?? null,
      event: {
        id: r.listing.ticket.event.id,
        title: r.listing.ticket.event.title,
        slug: r.listing.ticket.event.slug,
      },
      listingId: r.listingId,
      sellerId: r.listing.sellerId,
    }));
  }

  async markPaid(
    orgId: string,
    checkoutId: string,
    actor: { id: string; role?: string },
    body: { reference: string; paidAt?: string }
  ) {
    if (!['ADMIN', 'SUPER_ADMIN', 'FINANCE'].includes(String(actor.role ?? ''))) {
      throw new ForbiddenException('Sin permiso para marcar pagos de reventa');
    }
    const reference = String(body.reference ?? '')
      .trim()
      .slice(0, 120);
    if (!reference) throw new BadRequestException('Indica la referencia SPEI');
    const row = await this.prisma.resaleCheckout.findFirst({
      where: { id: checkoutId, organizationId: orgId, status: OrderStatus.COMPLETED },
    });
    if (!row) throw new NotFoundException('Pago de reventa no encontrado');
    if (row.payoutStatus === 'PAID') {
      return {
        id: row.id,
        payoutStatus: row.payoutStatus,
        payoutReference: row.payoutReference,
        payoutPaidAt: row.payoutPaidAt?.toISOString() ?? null,
      };
    }
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    const updated = await this.prisma.resaleCheckout.update({
      where: { id: row.id },
      data: {
        payoutStatus: 'PAID',
        payoutReference: reference,
        payoutPaidAt: paidAt,
        payoutPaidById: actor.id,
      },
    });
    await this.audit.log({
      action: 'RESALE_SELLER_PAYOUT_PAID',
      entityType: 'ResaleCheckout',
      entityId: updated.id,
      organizationId: orgId,
      userId: actor.id,
      metadata: {
        reference,
        amount: updated.sellerPayout.toString(),
        paidAt: paidAt.toISOString(),
      },
    });
    return {
      id: updated.id,
      payoutStatus: updated.payoutStatus,
      payoutReference: updated.payoutReference,
      payoutPaidAt: updated.payoutPaidAt?.toISOString() ?? null,
    };
  }

  async exportCsv(orgId: string, filters: SellerPayoutFilters = {}) {
    const rows = await this.list(orgId, filters);
    const header = [
      'id',
      'publicId',
      'event',
      'sellerPayout',
      'fee',
      'currency',
      'payoutStatus',
      'sellerClabe',
      'payoutReference',
      'completedAt',
      'payoutPaidAt',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.publicId,
          csvEscape(r.event.title),
          r.sellerPayout,
          r.fee,
          r.currency,
          r.payoutStatus,
          r.sellerClabe ?? '',
          r.payoutReference ?? '',
          r.completedAt ?? '',
          r.payoutPaidAt ?? '',
        ].join(',')
      );
    }
    return lines.join('\n') + '\n';
  }

  /** El vendedor guarda CLABE (validada) y se aplica a ventas pendientes. */
  async saveSellerClabe(userId: string, rawClabe: unknown) {
    const checked = checkClabe(rawClabe);
    if (checked.ok === false) {
      throw new BadRequestException(checked.message);
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { resalePayoutClabe: checked.clabe, resalePayoutClabeAt: now },
    });
    await this.prisma.resaleCheckout.updateMany({
      where: {
        status: OrderStatus.COMPLETED,
        payoutStatus: 'PENDING',
        listing: { sellerId: userId },
      },
      data: { sellerClabe: checked.clabe },
    });
    return { clabe: maskClabe(checked.clabe), savedAt: now.toISOString() };
  }

  async sellerClabeStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { resalePayoutClabe: true, resalePayoutClabeAt: true },
    });
    return {
      clabe: maskClabe(user?.resalePayoutClabe),
      savedAt: user?.resalePayoutClabeAt?.toISOString() ?? null,
    };
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
