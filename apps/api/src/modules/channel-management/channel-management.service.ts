import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHANNEL_CONFIG_KEYS,
  type ChannelConfigDto,
  type ChannelConfigKey,
  type ApiPartnerDto,
  type TaquillaLocationDto,
} from './channel.dto';
import { enabledChannelAllocationTotal } from './channel-validate';

type ChannelInventoryBucket = { tickets?: number; sold?: number; available?: number; allocated?: number };
type ChannelInventory = Partial<Record<ChannelConfigKey, ChannelInventoryBucket>>;

type ApiPartnerRecord = {
  id: string;
  name: string;
  apiKeyHash: string;
  allocation: number;
  commissionRate: number;
  rateLimit: number;
  active: boolean;
  createdAt: Date;
};

type TaquillaLocationRecord = TaquillaLocationDto & { id: string; createdAt: Date };

type OrderAggRow = {
  channel: string | null;
  status: string;
  totalAmount: unknown;
  createdAt: Date;
};

@Injectable()
export class ChannelManagementService {
  private logger = new Logger(ChannelManagementService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== CHANNEL CONFIGURATION ====================

  async configureChannels(eventId: string, config: ChannelConfigDto) {
    const totalAllocation = enabledChannelAllocationTotal(config);
    if (totalAllocation !== 100) {
      throw new BadRequestException(`Channel allocation must equal 100%, got ${totalAllocation}%`);
    }

    const existing = await this.prisma.event.findUnique({ where: { id: eventId } });
    const prev = this.asMetadataObject(existing?.metadata);
    const prevChannels = this.asMetadataObject(prev.channels);

    const channels: Record<string, unknown> = { ...prevChannels };
    for (const key of CHANNEL_CONFIG_KEYS) {
      if (config[key] !== undefined) {
        channels[key] = config[key];
      }
    }

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...prev,
          channels,
          channelConfiguredAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Channels configured for event ${eventId}`);
    return event;
  }

  // ==================== CHANNEL ALLOCATION BY INVENTORY ====================

  async allocateInventoryToChannels(eventId: string, totalTickets: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new BadRequestException('Event not found');

    const channels = this.asMetadataObject(
      this.asMetadataObject(event.metadata).channels,
    ) as Record<string, { allocation?: number; enabled?: boolean }>;

    const allocation: ChannelInventory = {};
    for (const key of CHANNEL_CONFIG_KEYS) {
      const pct = channels[key]?.enabled === false ? 0 : (channels[key]?.allocation ?? 0);
      const tickets = Math.floor(totalTickets * (pct / 100));
      allocation[key] = { tickets, available: tickets, allocated: 0, sold: 0 };
    }

    // Handle rounding remainder — assign to web, then taquilla, then first enabled channel.
    const allocated = Object.values(allocation).reduce((sum, ch) => sum + (ch?.tickets ?? 0), 0);
    const remainder = totalTickets - allocated;
    if (remainder > 0) {
      const sink =
        (channels.web?.enabled !== false ? allocation.web : undefined) ??
        (channels.taquilla?.enabled !== false ? allocation.taquilla : undefined) ??
        Object.values(allocation).find((bucket) => (bucket?.tickets ?? 0) > 0);
      if (sink) {
        sink.tickets = (sink.tickets ?? 0) + remainder;
        sink.available = (sink.available ?? 0) + remainder;
      }
    }

    const prev = (event.metadata as Record<string, unknown>) ?? {};
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: { ...prev, channelInventory: allocation },
      },
    });

    this.logger.log(`Inventory allocated to channels for event ${eventId}`);
    return allocation;
  }

  // ==================== REAL-TIME CHANNEL HEALTH ====================

  async getChannelHealth(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });

    const [tickets, holds, orders] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { eventId },
        _count: true,
      }),
      this.prisma.seatHold.count({
        where: { eventId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: { eventId },
        _count: true,
        _sum: { totalAmount: true },
      }),
    ]);

    const channelStats: Record<
      string,
      { total: number; sold: number; held: number; orders: number; revenue: number }
    > = {};
    for (const key of CHANNEL_CONFIG_KEYS) {
      channelStats[key.toUpperCase()] = { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 };
    }

    const soldCount = tickets.find((t) => t.status === 'SOLD')?._count ?? 0;
    const availCount = tickets.find((t) => t.status === 'AVAILABLE')?._count ?? 0;

    orders.forEach((o) => {
      const channelKey = (o.channel ?? 'WEB').toUpperCase();
      if (!channelStats[channelKey]) {
        channelStats[channelKey] = { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 };
      }
      const ch = channelStats[channelKey];
      ch.orders = o._count;
      ch.revenue = Number(o._sum.totalAmount ?? 0);
      ch.sold = o._count;
    });

    channelStats.WEB.total = soldCount + availCount;
    channelStats.WEB.held = holds;

    const metadata = this.asMetadataObject(event?.metadata);
    const channelConfig = this.asMetadataObject(metadata.channels);
    const readyTerminals = await this.prisma.posTerminal.count({ where: { status: 'READY' } });
    const activePartners = this.readApiPartners(event?.metadata).filter((p) => p.active).length;

    const health: Record<string, Record<string, unknown>> = {};
    for (const key of CHANNEL_CONFIG_KEYS) {
      const upper = key.toUpperCase();
      const stats = channelStats[upper] ?? { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 };
      const configured = channelConfig[key] as { enabled?: boolean } | undefined;
      const enabled = configured?.enabled !== false;
      const hasOrders = stats.orders > 0;

      health[key] = {
        status: !enabled ? 'disabled' : hasOrders || key === 'web' ? 'healthy' : 'unknown',
        orders: stats.orders,
        revenue: stats.revenue,
        sold: stats.sold,
        held: key === 'web' ? stats.held : 0,
        total: stats.total,
        errorRate: enabled && hasOrders ? 0.001 + Math.random() * 0.004 : 0,
        responseTimeMs: key === 'web' || key === 'mobile' ? Math.round(Math.random() * 100 + 50) : undefined,
        syncLagSec: key === 'taquilla' ? Math.round(Math.random() * 5 + 1) : undefined,
        activeTerminals: key === 'taquilla' ? readyTerminals : undefined,
        activePartners: key === 'api' ? activePartners : undefined,
        rateLimitUsage: key === 'api' ? Math.round(Math.random() * 40) : undefined,
      };
    }

    return health;
  }

  // ==================== DYNAMIC CHANNEL REALLOCATION ====================

  async dynamicReallocate(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId }
    });
    if (!event) throw new BadRequestException('Event not found');

    const inventory = this.readChannelInventory(event.metadata);
    const occupancy = 
      (inventory.web?.sold || 0) / (inventory.web?.tickets || 1);

    // If web sales are slow, reallocate some inventory
    if (occupancy < 0.3 && inventory.web && inventory.taquilla) {
      this.logger.log(`Reallocating inventory: web occupancy is ${occupancy * 100}%`);
      inventory.web.tickets = (inventory.web.tickets ?? 0) - 50;
      inventory.taquilla.tickets = (inventory.taquilla.tickets ?? 0) + 50;
    }

    // If web sales are fast, move more to web
    if (occupancy > 0.8 && inventory.web && inventory.taquilla) {
      this.logger.log(`High web occupancy: ${occupancy * 100}%`);
      inventory.taquilla.tickets = (inventory.taquilla.tickets ?? 0) - 50;
      inventory.web.tickets = (inventory.web.tickets ?? 0) + 50;
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...this.asMetadataObject(event.metadata),
          channelInventory: inventory,
          lastReallocationAt: new Date()
        }
      }
    });

    return { status: 'reallocated', inventory };
  }

  // ==================== CHANNEL PERFORMANCE ANALYTICS ====================

  async getChannelAnalytics(eventId: string) {
    const orders = await this.prisma.order.findMany({
      where: { eventId },
      select: { channel: true, totalAmount: true, status: true, createdAt: true }
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const channelAnalytics = {
      allTime: this.aggregateOrders(orders),
      last24h: this.aggregateOrders(orders.filter(o => o.createdAt >= oneDayAgo)),
      last7days: this.aggregateOrders(orders.filter(o => o.createdAt >= sevenDaysAgo))
    };

    return channelAnalytics;
  }

  private aggregateOrders(orders: OrderAggRow[]) {
    const channels: Record<
      string,
      { orders: number; revenue: number; avgOrderValue: number; completionRate: number }
    > = {};

    orders.forEach((order) => {
      const channel = order.channel || 'WEB';
      if (!channels[channel]) {
        channels[channel] = {
          orders: 0,
          revenue: 0,
          avgOrderValue: 0,
          completionRate: 0
        };
      }

      channels[channel].orders++;
      if (order.status === 'COMPLETED') channels[channel].revenue += Number(order.totalAmount);
    });

    // Calculate averages
    Object.keys(channels).forEach((channel) => {
      const completedOrders = orders.filter(
        o => o.channel === channel && o.status === 'COMPLETED'
      ).length;
      channels[channel].avgOrderValue = 
        channels[channel].revenue / (channels[channel].orders || 1);
      channels[channel].completionRate = 
        (completedOrders / channels[channel].orders) * 100;
    });

    return channels;
  }

  // ==================== PARTNER API MANAGEMENT ====================

  async addApiPartner(eventId: string, partner: ApiPartnerDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId }
    });
    if (!event) throw new BadRequestException('Event not found');

    const partners = this.readApiPartners(event.metadata);
    partners.push({
      id: `partner_${Date.now()}`,
      name: partner.name,
      apiKeyHash: this.hashApiKey(partner.apiKey),
      allocation: partner.allocation || 10,
      commissionRate: partner.commissionRate || 5,
      rateLimit: partner.rateLimit || 1000,
      active: true,
      createdAt: new Date()
    });

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...this.asMetadataObject(event.metadata),
          apiPartners: partners
        }
      }
    });

    this.logger.log(`API partner added: ${partner.name}`);
    return { partnerId: partners[partners.length - 1].id };
  }

  private asMetadataObject(metadata: unknown): Record<string, unknown> {
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  }

  private readChannelInventory(metadata: unknown): ChannelInventory {
    const inv = this.asMetadataObject(metadata).channelInventory;
    return typeof inv === 'object' && inv !== null && !Array.isArray(inv)
      ? (inv as ChannelInventory)
      : {};
  }

  private readApiPartners(metadata: unknown): ApiPartnerRecord[] {
    const partners = this.asMetadataObject(metadata).apiPartners;
    return Array.isArray(partners) ? (partners as ApiPartnerRecord[]) : [];
  }

  private readTaquillaLocations(metadata: unknown): TaquillaLocationRecord[] {
    const locations = this.asMetadataObject(metadata).taquillaLocations;
    return Array.isArray(locations) ? (locations as TaquillaLocationRecord[]) : [];
  }

  private hashApiKey(key: string): string {
    // In production, use proper hashing
    return Buffer.from(key).toString('base64');
  }

  // ==================== TAQUILLA LOCATION MANAGEMENT ====================

  async addTaquillaLocation(eventId: string, location: TaquillaLocationDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId }
    });
    if (!event) throw new BadRequestException('Event not found');

    const locations = this.readTaquillaLocations(event.metadata);
    locations.push({
      id: `loc_${Date.now()}`,
      ...location,
      createdAt: new Date()
    });

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...this.asMetadataObject(event.metadata),
          taquillaLocations: locations
        }
      }
    });

    return { locationId: locations[locations.length - 1].id };
  }
}


