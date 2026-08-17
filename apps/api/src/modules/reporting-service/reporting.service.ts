import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SalesChannel } from '@prisma/client';
import { Observable, from, map, mergeMap, timer } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/** Caracteres con los que Excel y Sheets interpretan la celda como fórmula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Convierte un valor en una celda CSV segura.
 *
 * Dos problemas distintos, ambos reales en un export que abre un operador:
 *
 * 1. **Escape de CSV**: comas, comillas y saltos de línea dentro de un título de
 *    evento o un nombre parten la fila y descuadran todas las columnas
 *    siguientes.
 * 2. **Inyección de fórmulas**: un nombre de comprador que empiece por `=` o `@`
 *    lo ejecuta la hoja de cálculo al abrirla. Como el nombre lo escribe el
 *    propio comprador en el checkout, es entrada no confiable. Se antepone un
 *    apóstrofo para que la hoja lo trate como texto.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

@Injectable()
export class ReportingService {
  private logger = new Logger(ReportingService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== REAL-TIME DASHBOARD ====================

  async getRealtimeDashboard(organizationId: string, eventId?: string) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // F2-10: `?eventId=` es libre y el guard sólo valida `:organizationId`.
    // Los agregados de pedidos ya filtraban por organización, pero el título del
    // evento y los conteos de boletos (`totalTickets`/`soldTickets`) van sólo
    // por `eventId`: sin este filtro, apuntar al evento de otro promotor
    // devolvía su nombre y su ocupación real.
    const event = eventId
      ? await this.prisma.event.findFirst({
          where: { id: eventId, organizationId },
          include: { venue: true, organization: true }
        })
      : null;

    if (eventId && !event) {
      throw new ForbiddenException('Organization access denied');
    }

    // Today's sales
    const todaySales = await this.prisma.order.findMany({
      where: {
        organizationId,
        ...(eventId && { eventId }),
        status: 'COMPLETED',
        createdAt: { gte: today }
      }
    });

    const todayRevenue = todaySales.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // This week's sales
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekSales = await this.prisma.order.findMany({
      where: {
        organizationId,
        ...(eventId && { eventId }),
        status: 'COMPLETED',
        createdAt: { gte: weekAgo }
      }
    });

    const weekRevenue = weekSales.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // Channel breakdown
    const channelSales = await this.prisma.order.groupBy({
      by: ['channel'],
      where: {
        organizationId,
        ...(eventId && { eventId }),
        status: 'COMPLETED',
        createdAt: { gte: weekAgo }
      },
      _sum: { totalAmount: true },
      _count: true
    });

    const channelData = channelSales.map(cs => ({
      channel: cs.channel,
      orders: cs._count,
      revenue: Number(cs._sum.totalAmount ?? 0),
    }));

    // Occupancy
    const totalTickets = eventId
      ? await this.prisma.ticket.count({ where: { eventId } })
      : 0;

    const soldTickets = eventId
      ? await this.prisma.ticket.count({
          where: { eventId, status: { in: ['SOLD', 'HELD'] } }
        })
      : 0;

    const occupancy = totalTickets > 0 ? (soldTickets / totalTickets) * 100 : 0;

    // Key metrics
    const avgOrderValue = todaySales.length > 0 
      ? todayRevenue / todaySales.length 
      : 0;

    const previousWeekRevenue = await this.getPreviousWeekRevenue(organizationId, eventId);
    const growthPct =
      previousWeekRevenue > 0
        ? (((weekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100).toFixed(1)
        : weekRevenue > 0
          ? '100.0'
          : '0.0';

    return {
      generatedAt: now,
      event: event ? { id: event.id, title: event.title } : null,
      metrics: {
        todayRevenue: parseFloat(todayRevenue.toFixed(2)),
        todayOrders: todaySales.length,
        weekRevenue: parseFloat(weekRevenue.toFixed(2)),
        weekOrders: weekSales.length,
        avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
        occupancy: parseFloat(occupancy.toFixed(1)),
        soldTickets,
        totalTickets
      },
      channels: channelData,
      trend: {
        previousWeekRevenue: parseFloat(previousWeekRevenue.toFixed(2)),
        growth: `${growthPct}%`,
      },
    };
  }

  // ==================== SETTLEMENT REPORTS ====================

  async generateSettlementReport(organizationId: string, period: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
    const now = new Date();
    let dateFilter: { gte: Date; lt: Date };

    if (period === 'DAILY') {
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      };
    } else if (period === 'WEEKLY') {
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      dateFilter = {
        gte: startOfWeek,
        lt: new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
      };
    } else {
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
      };
    }

    // Get all completed orders
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        createdAt: dateFilter
      },
      include: {
        event: true,
        items: true,
        payment: true,
      },
    });

    const grossRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // Commission & fees
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId }
    });

    const commissionRate = organization?.commissionRate || 0.15;
    const commissionAmount = grossRevenue * commissionRate;
    const netRevenue = grossRevenue - commissionAmount;

    // Payment breakdown
    const paymentMethods: Record<string, { count: number; amount: number }> = {};

    for (const order of orders) {
      if (!order.payment) continue;
      const gateway = String(order.payment.gateway ?? 'unknown');
      if (!paymentMethods[gateway]) {
        paymentMethods[gateway] = { count: 0, amount: 0 };
      }
      paymentMethods[gateway].count++;
      paymentMethods[gateway].amount += Number(order.payment.amount ?? 0);
    }

    return {
      organizationId,
      period,
      dateRange: dateFilter,
      summary: {
        grossRevenue: parseFloat(grossRevenue.toFixed(2)),
        commission: parseFloat(commissionAmount.toFixed(2)),
        netRevenue: parseFloat(netRevenue.toFixed(2)),
        totalOrders: orders.length,
        avgOrderValue: orders.length > 0 
          ? parseFloat((grossRevenue / orders.length).toFixed(2))
          : 0
      },
      paymentMethods,
      generatedAt: now
    };
  }

  // ==================== HEATMAP ANALYTICS ====================

  async getOccupancyHeatmap(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId }
    });

    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
    });

    const heatmap: Record<string, { sold: number; total: number; percentage: number }> = {};

    for (const ticket of tickets) {
      const section = ticket.section || 'general';

      if (!heatmap[section]) {
        heatmap[section] = { sold: 0, total: 0, percentage: 0 };
      }

      heatmap[section].total++;
      if (ticket.status === 'SOLD') {
        heatmap[section].sold++;
      }
    }

    // Calculate percentages
    for (const section in heatmap) {
      heatmap[section].percentage = 
        (heatmap[section].sold / heatmap[section].total) * 100 || 0;
    }

    return {
      eventId,
      eventTitle: event?.title,
      heatmap,
      generatedAt: new Date()
    };
  }

  // ==================== PREDICTIVE ANALYTICS ====================

  async predictOccupancy(eventId: string): Promise<{ predictedOccupancy: number; confidence: number; recommendation: string }> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { orders: true, tickets: true } } }
    });

    if (!event) {
      return { predictedOccupancy: 0, confidence: 0, recommendation: 'Event not found' };
    }

    const currentOccupancy = event._count.tickets > 0
      ? (event._count.orders / event._count.tickets) * 100
      : 0;

    // Days until event
    const daysUntil = Math.ceil(
      (new Date(event.startsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // Predictive model (simplified)
    // Assumptions: Sales accelerate closer to event date
    let predictedOccupancy = currentOccupancy;
    let confidence = 0;

    if (daysUntil > 60) {
      // Early stage: predict based on historical similar events
      predictedOccupancy = currentOccupancy + (daysUntil * 0.5); // 0.5% per day
      confidence = 0.4;
    } else if (daysUntil > 14) {
      // Mid stage: acceleration predicted
      predictedOccupancy = currentOccupancy + (daysUntil * 1.5);
      confidence = 0.65;
    } else if (daysUntil > 0) {
      // Final stage: high confidence
      predictedOccupancy = currentOccupancy + (daysUntil * 3);
      confidence = 0.85;
    }

    predictedOccupancy = Math.min(predictedOccupancy, 100);

    // Recommendation
    let recommendation = '';
    if (predictedOccupancy > 85) {
      recommendation = 'Event trending towards SOLD OUT. Consider price increase or demand-based pricing.';
    } else if (predictedOccupancy > 60) {
      recommendation = 'Event on track for strong sales. Monitor and optimize marketing.';
    } else if (predictedOccupancy > 30) {
      recommendation = 'Moderate sales. Consider promotional campaigns or price reductions.';
    } else {
      recommendation = 'Low occupancy predicted. Urgent action required - evaluate pricing, marketing, or event details.';
    }

    return {
      predictedOccupancy: parseFloat(predictedOccupancy.toFixed(1)),
      confidence: parseFloat(confidence.toFixed(2)),
      recommendation
    };
  }

  // ==================== CHANNEL PERFORMANCE ====================

  async getChannelPerformance(organizationId: string, eventId?: string) {
    const channels: SalesChannel[] = [
      SalesChannel.WEB,
      SalesChannel.TAQUILLA,
      SalesChannel.API,
      SalesChannel.ADMIN,
    ];

    const performance = await Promise.all(
      channels.map(async (channel) => {
        const orders = await this.prisma.order.findMany({
          where: {
            organizationId,
            channel,
            ...(eventId && { eventId }),
            status: 'COMPLETED'
          }
        });

        const revenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
        const avgValue = orders.length > 0 ? revenue / orders.length : 0;

        return {
          channel,
          orders: orders.length,
          revenue: parseFloat(revenue.toFixed(2)),
          avgOrderValue: parseFloat(avgValue.toFixed(2)),
          percentage: 0 // Will calculate after all channels
        };
      })
    );

    const totalRevenue = performance.reduce((sum, p) => sum + p.revenue, 0);

    // Calculate percentages
    performance.forEach(p => {
      p.percentage = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
    });

    return {
      channels: performance,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      generatedAt: new Date()
    };
  }

  // ==================== CUSTOMER ANALYTICS ====================

  async getCustomerAnalytics(organizationId: string) {
    // Repeat customers
    const customerOrders = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { organizationId, status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    const repeatCustomers = customerOrders.filter((co) => co._count._all >= 2).length;
    const newCustomers = customerOrders.filter((co) => co._count._all === 1).length;

    const totalSpent = customerOrders.reduce(
      (sum, co) => sum + Number(co._sum?.totalAmount ?? 0),
      0,
    );
    const avgCustomerValue = customerOrders.length > 0 
      ? totalSpent / customerOrders.length 
      : 0;

    return {
      uniqueCustomers: customerOrders.length,
      repeatCustomers,
      newCustomers,
      repeatRate: customerOrders.length > 0 
        ? (repeatCustomers / customerOrders.length) * 100 
        : 0,
      totalSpent: parseFloat(totalSpent.toFixed(2)),
      avgCustomerValue: parseFloat(avgCustomerValue.toFixed(2))
    };
  }

  // ==================== REVENUE FORECAST ====================

  async generateRevenueForecast(organizationId: string, days: number = 30) {
    // `:days` viene de la URL sin validar y el bucle lanza una consulta por día:
    // `/forecast/:org/100000` eran 100 000 consultas secuenciales por petición.
    const horizon = Math.min(Math.max(Number.isFinite(days) ? Math.trunc(days) : 30, 1), 365);
    const forecast = [];
    const now = new Date();

    for (let i = 0; i < horizon; i++) {
      const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      date.setHours(0, 0, 0, 0);

      const actualOrders = await this.prisma.order.findMany({
        where: {
          organizationId,
          status: 'COMPLETED',
          createdAt: {
            gte: date,
            lt: new Date(date.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      });

      const actualRevenue = actualOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

      // Simple forecast: same as previous day + trend
      const predictedRevenue = actualRevenue * 1.05; // 5% growth assumption

      forecast.push({
        date: date.toISOString().split('T')[0],
        actual: parseFloat(actualRevenue.toFixed(2)),
        predicted: parseFloat(predictedRevenue.toFixed(2))
      });
    }

    return {
      organizationId,
      forecastDays: horizon,
      forecast,
      generatedAt: now
    };
  }

  // ==================== HELPER ====================

  streamRealtimeDashboard(organizationId: string, eventId?: string): Observable<MessageEvent> {
    return timer(0, 10_000).pipe(
      mergeMap(() => from(this.getRealtimeDashboard(organizationId, eventId))),
      map((data) => ({ data: JSON.stringify(data) } as MessageEvent)),
    );
  }

  async exportSalesCsv(organizationId: string, from?: Date, to?: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        ...(from || to
          ? {
              createdAt: {
                ...(from && { gte: from }),
                ...(to && { lte: to }),
              },
            }
          : {}),
      },
      include: { event: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const header = 'publicId,event,channel,total,currency,createdAt,buyerEmail';
    const rows = orders.map(
      (o) =>
        [
          csvCell(o.publicId),
          csvCell(o.event.title),
          csvCell(o.channel),
          csvCell(o.totalAmount),
          csvCell(o.currency),
          csvCell(o.createdAt.toISOString()),
          csvCell(o.buyerEmail),
        ].join(','),
    );
    return { filename: `ventas-${organizationId}-${Date.now()}.csv`, csv: [header, ...rows].join('\n') };
  }

  private async getPreviousWeekRevenue(organizationId: string, eventId?: string): Promise<number> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const previousWeekOrders = await this.prisma.order.findMany({
      where: {
        organizationId,
        ...(eventId && { eventId }),
        status: 'COMPLETED',
        createdAt: { gte: twoWeeksAgo, lt: weekAgo }
      }
    });

    return previousWeekOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  }
}


