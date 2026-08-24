import { BadRequestException, Injectable } from '@nestjs/common';
import { SalesChannel } from '@prisma/client';
import { channelInventoryKey } from '../../common/sales-channel';
import { PrismaService } from '../prisma/prisma.service';

type ChannelBucket = {
  tickets: number;
  available: number;
  allocated: number;
  sold: number;
};

type ChannelInventory = Record<string, ChannelBucket>;

@Injectable()
export class ChannelQuotaService {
  constructor(private prisma: PrismaService) {}

  private channelKey(channel: SalesChannel): string {
    return channelInventoryKey(channel);
  }

  /** Throws if channel inventory is configured and quota is exhausted. */
  async assertAvailable(eventId: string, channel: SalesChannel, quantity: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    const meta = (event?.metadata as Record<string, unknown>) ?? {};
    const inventory = meta.channelInventory as ChannelInventory | undefined;
    if (!inventory) return; // quotas not configured → allow

    const key = this.channelKey(channel);
    const bucket = inventory[key];
    if (!bucket) return;

    if ((bucket.available ?? 0) < quantity) {
      throw new BadRequestException(
        `Channel ${key} quota exhausted (${bucket.available ?? 0} left, need ${quantity})`,
      );
    }
  }

  /** Decrement available / increment sold after a successful order (best-effort). */
  async consume(eventId: string, channel: SalesChannel, quantity: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    if (!event) return;
    const meta = (event.metadata as Record<string, unknown>) ?? {};
    const inventory = { ...((meta.channelInventory as ChannelInventory) ?? {}) };
    if (!Object.keys(inventory).length) return;

    const key = this.channelKey(channel);
    const bucket = inventory[key];
    if (!bucket) return;

    inventory[key] = {
      ...bucket,
      available: Math.max(0, (bucket.available ?? 0) - quantity),
      sold: (bucket.sold ?? 0) + quantity,
      allocated: (bucket.allocated ?? 0) + quantity,
    };

    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...meta, channelInventory: inventory } },
    });
  }

  /** Restore quota when hold released or refund (best-effort). */
  async release(eventId: string, channel: SalesChannel, quantity: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    if (!event) return;
    const meta = (event.metadata as Record<string, unknown>) ?? {};
    const inventory = { ...((meta.channelInventory as ChannelInventory) ?? {}) };
    if (!Object.keys(inventory).length) return;

    const key = this.channelKey(channel);
    const bucket = inventory[key];
    if (!bucket) return;

    inventory[key] = {
      ...bucket,
      available: Math.min(bucket.tickets ?? bucket.available + quantity, (bucket.available ?? 0) + quantity),
      sold: Math.max(0, (bucket.sold ?? 0) - quantity),
    };

    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...meta, channelInventory: inventory } },
    });
  }
}
