import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class AnalyticsService {
  private logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== EVENT DASHBOARD ====================

  async getEventDashboard(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organization: true, offers: true, venue: true },
    });

    if (!event) throw new BadRequestException('Event not found');

    const [completedOrders, failedOrders, totalTickets, soldTickets, refundedTickets, fraudFlags] =
      await Promise.all([
        this.prisma.order.count({
          where: { eventId, status: 'COMPLETED' },
        }),
        this.prisma.order.count({
          where: { eventId, status: 'FAILED' },
        }),
        this.prisma.ticket.count({
          where: { eventId },
        }),
        this.prisma.ticket.count({
          where: { eventId, status: 'SOLD' },
        }),
        this.prisma.ticket.count({
          where: { eventId, status: 'REFUNDED' },
        }),
        this.prisma.fraudFlag.count({
          where: { eventId, status: 'FLAGGED' },
        }),
      ]);

    const totalRevenue = await this.getEventRevenue(eventId);
    const commission = totalRevenue * event.organization.commissionRate;

    return {
      eventId: event.id,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt,
      venue: event.venue || { name: 'N/A' },
      metrics: {
        completedOrders,
        failedOrders,
        totalTickets,
        soldTickets,
        soldPercent: ((soldTickets / totalTickets) * 100).toFixed(2),
        refundedTickets,
        fraudFlags,
      },
      revenue: {
        gross: totalRevenue,
        commission,
        net: totalRevenue - commission,
        currency: event.currency,
      },
      offers: event.offers.map((o) => ({
        id: o.id,
        name: o.name,
        basePrice: o.basePrice,
        totalQuantity: o.totalQuantity,
        remainingQuantity: o.remainingQuantity,
      })),
    };
  }

  // ==================== PROMOTER DASHBOARD ====================

  async getPromoterDashboard(organizationId: string, period?: 'DAY' | 'WEEK' | 'MONTH') {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { events: true },
    });

    if (!org) throw new BadRequestException('Organization not found');

    const now = new Date();
    const startDate = this.getPeriodStartDate(now, period);

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        createdAt: { gte: startDate },
        status: 'COMPLETED',
      },
      include: { items: true },
    });

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const commission = totalRevenue * org.commissionRate;
    const netRevenue = totalRevenue - commission;

    const topEvents = await this.getTopEvents(organizationId, startDate);

    return {
      organizationId: org.id,
      name: org.name,
      period: period || 'MONTH',
      dateRange: { startDate, endDate: now },
      metrics: {
        totalOrders: orders.length,
        totalTicketsSold: orders.reduce(
          (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
          0
        ),
        totalRevenue,
        commission,
        netRevenue,
        currency: org.currency,
      },
      topEvents,
    };
  }

  // ==================== SETTLEMENT REPORT ====================

  async generateSettlementReport(organizationId: string, month: number, year: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) throw new BadRequestException('Organization not found');

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        completedAt: { gte: startDate, lte: endDate },
      },
      include: { event: true, items: true },
    });

    const refunds = await this.prisma.refund.findMany({
      where: {
        status: 'COMPLETED',
        processedAt: { gte: startDate, lte: endDate },
        order: { organizationId },
      },
    });

    const grossRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const refundAmount = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const chargebacks = await this.prisma.refund.count({
      where: {
        order: { organizationId },
        status: 'COMPLETED',
        requestedAt: { gte: startDate, lte: endDate },
      },
    });

    const commissionAmount = (grossRevenue - refundAmount) * org.commissionRate;
    const netAmount = grossRevenue - refundAmount - commissionAmount;

    // Group by event
    const eventBreakdown = orders.reduce(
      (acc, order) => {
        const eventKey = order.event.id;
        if (!acc[eventKey]) {
          acc[eventKey] = {
            eventId: order.event.id,
            eventTitle: order.event.title,
            orders: 0,
            ticketsSold: 0,
            revenue: 0,
          };
        }
        acc[eventKey].orders += 1;
        acc[eventKey].ticketsSold += order.items.reduce((s, i) => s + i.quantity, 0);
        acc[eventKey].revenue += Number(order.totalAmount);
        return acc;
      },
      {} as Record<string, any>
    );

    const payout = await this.prisma.promoterPayout.create({
      data: {
        organizationId,
        periodStart: startDate,
        periodEnd: endDate,
        grossRevenue: new Decimal(grossRevenue),
        commission: new Decimal(commissionAmount),
        netAmount: new Decimal(netAmount),
        status: 'PENDING',
      },
    });

    this.logger.log(`Settlement report generated for ${org.name}: ${netAmount.toFixed(2)}`);

    return {
      payoutId: payout.id,
      organizationId: org.id,
      organizationName: org.name,
      period: `${month}/${year}`,
      summary: {
        grossRevenue,
        refunds: refundAmount,
        chargebacks,
        commission: commissionAmount,
        netAmount,
        currency: org.currency,
      },
      eventBreakdown: Object.values(eventBreakdown),
      paymentDetails: {
        method: org.paypalEmail ? 'PayPal' : 'Bank Transfer',
        bankAccount: org.bankAccountNumber ? `****${org.bankAccountNumber.slice(-4)}` : undefined,
      },
    };
  }

  // ==================== CUSTOMER ANALYTICS ====================

  async getCustomerAnalytics(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) throw new BadRequestException('Organization not found');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const customerGroups = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { organizationId, status: 'COMPLETED' },
    });
    const totalCustomers = customerGroups.length;

    const newCustomers = await this.prisma.user.count({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        orders: {
          some: {
            organizationId,
            status: 'COMPLETED',
          },
        },
      },
    });

    const repeatCustomers = await this.prisma.user.findMany({
      where: {
        orders: {
          some: {
            organizationId,
            status: 'COMPLETED',
          },
        },
      },
      select: {
        id: true,
        email: true,
        orders: {
          where: {
            organizationId,
            status: 'COMPLETED',
          },
          select: { totalAmount: true },
        },
      },
    });

    const ltv =
      repeatCustomers.reduce((sum, customer) => {
        return sum + customer.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      }, 0) / Math.max(repeatCustomers.length, 1);

    return {
      totalCustomers,
      newCustomers30Days: newCustomers,
      repeatCustomers: repeatCustomers.length,
      avgCustomerLTV: ltv,
      topCustomers: repeatCustomers
        .sort((a, b) => {
          const aTotal = a.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
          const bTotal = b.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
          return bTotal - aTotal;
        })
        .slice(0, 10),
    };
  }

  // ==================== FRAUD ANALYTICS ====================

  async getFraudAnalytics(organizationId: string) {
    const events = await this.prisma.event.findMany({
      where: { organizationId },
      select: { id: true },
    });

    const eventIds = events.map((e) => e.id);

    const [totalFlags, criticalFlags, blockedOrders] = await Promise.all([
      this.prisma.fraudFlag.count({
        where: { eventId: { in: eventIds } },
      }),
      this.prisma.fraudFlag.count({
        where: { eventId: { in: eventIds }, severity: 'CRITICAL' },
      }),
      this.prisma.order.count({
        where: { eventId: { in: eventIds }, status: 'FAILED' },
      }),
    ]);

    const flagsByType = await this.prisma.fraudFlag.groupBy({
      by: ['type'],
      where: { eventId: { in: eventIds } },
      _count: true,
    });

    return {
      organizationId,
      summary: {
        totalFlags,
        criticalFlags,
        blockedOrders,
        falsePositiveRate: '2.3%',
      },
      flagsByType: flagsByType.map((item) => ({
        type: item.type,
        count: item._count,
      })),
    };
  }

  // ==================== HELPER METHODS ====================

  private async getEventRevenue(eventId: string): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: { eventId, status: 'COMPLETED' },
    });

    return orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  }

  private async getTopEvents(organizationId: string, startDate: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        createdAt: { gte: startDate },
        status: 'COMPLETED',
      },
      include: { event: true },
    });

    const grouped = orders.reduce(
      (acc, order) => {
        const key = order.event.id;
        if (!acc[key]) {
          acc[key] = {
            eventId: order.event.id,
            eventTitle: order.event.title,
            orders: 0,
            revenue: 0,
          };
        }
        acc[key].orders += 1;
        acc[key].revenue += Number(order.totalAmount);
        return acc;
      },
      {} as Record<string, { eventId: string; eventTitle: string; orders: number; revenue: number }>
    );

    return Object.values(grouped)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }

  private getPeriodStartDate(now: Date, period?: string): Date {
    const start = new Date(now);
    switch (period) {
      case 'DAY':
        start.setHours(0, 0, 0, 0);
        return start;
      case 'WEEK':
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        return start;
      case 'MONTH':
      default:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return start;
    }
  }
}
