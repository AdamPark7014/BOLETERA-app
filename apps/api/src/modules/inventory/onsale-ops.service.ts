import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HoldStatus, OrderStatus, Prisma } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitingRoomConfig, WaitingRoomService } from './waiting-room.service';

export type OnsaleOpsSnapshot = {
  eventId: string;
  saleClosed: boolean;
  waitingRoom: {
    enabled: boolean;
    paused: boolean;
    opensAt: string | null;
    batchSize: number;
    batchIntervalSeconds: number;
    queueSize: number;
    admittedEstimate: number;
  };
  activeHolds: number;
  last30Min: {
    orders: number;
    tickets: number;
    revenue: number;
    paidOrders: number;
    failedOrders: number;
    paymentSuccessRate: number;
  };
  errorsPerMinute: { minute: string; count4xx: number; count5xx: number }[];
};

type WaitingRoomMeta = WaitingRoomConfig & {
  paused?: boolean;
  saleClosed?: boolean;
};

/**
 * Tablero de operación en vivo: métricas + controles de fila / cierre de venta.
 */
@Injectable()
export class OnsaleOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly waitingRoom: WaitingRoomService
  ) {}

  async snapshot(eventId: string): Promise<OnsaleOpsSnapshot> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const meta = this.readMeta(event.metadata);
    const since = new Date(Date.now() - 30 * 60_000);

    const [activeHolds, orders, queueSize] = await Promise.all([
      this.prisma.seatHold.count({
        where: {
          eventId,
          status: HoldStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.order.findMany({
        where: { eventId, createdAt: { gte: since } },
        select: {
          status: true,
          totalAmount: true,
          items: { select: { quantity: true } },
        },
      }),
      this.redis.isReady ? this.redis.zCard(`waitroom:${eventId}:queue`) : Promise.resolve(0),
    ]);

    let tickets = 0;
    let revenue = 0;
    let paid = 0;
    let failed = 0;
    for (const o of orders) {
      const qty = o.items.reduce((s, i) => s + i.quantity, 0);
      if (o.status === OrderStatus.COMPLETED) {
        paid += 1;
        tickets += qty;
        revenue += Number(o.totalAmount ?? 0);
      } else if (o.status === OrderStatus.FAILED || o.status === OrderStatus.CANCELLED) {
        failed += 1;
      }
    }
    const decided = paid + failed;
    const paymentSuccessRate = decided === 0 ? 1 : paid / decided;

    const config = await this.waitingRoom.configFor(eventId).catch(() => null);
    const admittedEstimate = config ? this.estimateAdmitted(config, meta.paused === true) : 0;

    return {
      eventId,
      saleClosed: meta.saleClosed === true,
      waitingRoom: {
        enabled: !!config,
        paused: meta.paused === true,
        opensAt: config?.opensAt ?? null,
        batchSize: config?.batchSize ?? 0,
        batchIntervalSeconds: config?.batchIntervalSeconds ?? 0,
        queueSize,
        admittedEstimate,
      },
      activeHolds,
      last30Min: {
        orders: orders.length,
        tickets,
        revenue,
        paidOrders: paid,
        failedOrders: failed,
        paymentSuccessRate,
      },
      errorsPerMinute: await this.readErrorBuckets(eventId),
    };
  }

  async patchControls(
    eventId: string,
    patch: {
      pauseAdmission?: boolean;
      batchSize?: number;
      batchIntervalSeconds?: number;
      closeSale?: boolean;
    }
  ): Promise<OnsaleOpsSnapshot> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const root = {
      ...((event.metadata as Record<string, unknown> | null) ?? {}),
    };
    const wr = {
      ...((root.waitingRoom as WaitingRoomMeta | undefined) ?? {
        enabled: false,
        opensAt: new Date().toISOString(),
        batchSize: 200,
        batchIntervalSeconds: 10,
      }),
    };

    if (patch.pauseAdmission !== undefined) wr.paused = patch.pauseAdmission;
    if (patch.closeSale !== undefined) wr.saleClosed = patch.closeSale;
    if (patch.batchSize !== undefined) {
      if (!(patch.batchSize > 0)) throw new BadRequestException('batchSize debe ser > 0');
      wr.batchSize = Math.floor(patch.batchSize);
    }
    if (patch.batchIntervalSeconds !== undefined) {
      if (!(patch.batchIntervalSeconds > 0)) {
        throw new BadRequestException('batchIntervalSeconds debe ser > 0');
      }
      wr.batchIntervalSeconds = Math.floor(patch.batchIntervalSeconds);
    }

    root.waitingRoom = wr;
    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: root as Prisma.InputJsonValue },
    });

    return this.snapshot(eventId);
  }

  /** Contadores de error HTTP (los llena el filtro / interceptor). */
  async recordHttpError(eventId: string | undefined, status: number): Promise<void> {
    if (!eventId || status < 400) return;
    const minute = new Date().toISOString().slice(0, 16);
    const key = `onsale:errors:${eventId}:${minute}`;
    const field = status >= 500 ? '5xx' : '4xx';
    const current = (await this.redis.getJson<Record<string, number>>(key)) ?? {};
    current[field] = (current[field] ?? 0) + 1;
    await this.redis.setJson(key, current, 2 * 60 * 60);
  }

  isSaleClosed(metadata: unknown): boolean {
    return this.readMeta(metadata).saleClosed === true;
  }

  isAdmissionPaused(metadata: unknown): boolean {
    return this.readMeta(metadata).paused === true;
  }

  private readMeta(metadata: unknown): WaitingRoomMeta {
    const raw = (metadata as Record<string, unknown> | null)?.waitingRoom as
      | WaitingRoomMeta
      | undefined;
    return (
      raw ?? {
        enabled: false,
        opensAt: '',
        batchSize: 200,
        batchIntervalSeconds: 10,
      }
    );
  }

  private estimateAdmitted(config: WaitingRoomConfig, paused: boolean): number {
    if (paused) return 0;
    const elapsedMs = Date.now() - new Date(config.opensAt).getTime();
    if (elapsedMs < 0) return 0;
    const batches = Math.floor(elapsedMs / (config.batchIntervalSeconds * 1000)) + 1;
    return batches * config.batchSize;
  }

  private async readErrorBuckets(eventId: string) {
    const out: OnsaleOpsSnapshot['errorsPerMinute'] = [];
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const minute = new Date(now - i * 60_000).toISOString().slice(0, 16);
      const row = await this.redis.getJson<{ '4xx'?: number; '5xx'?: number }>(
        `onsale:errors:${eventId}:${minute}`
      );
      out.push({
        minute,
        count4xx: row?.['4xx'] ?? 0,
        count5xx: row?.['5xx'] ?? 0,
      });
    }
    return out.reverse();
  }
}
