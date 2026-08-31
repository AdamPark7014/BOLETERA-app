import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, SalesChannel } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class TaquillaPosService {
  private logger = new Logger(TaquillaPosService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
    private orders: OrdersService,
  ) {}

  async initializeTerminal(data: {
    organizationId: string;
    locationName: string;
    terminalName: string;
    hardwareConfig?: Record<string, string>;
  }) {
    const existing = await this.prisma.posTerminal.findFirst({
      where: {
        organizationId: data.organizationId,
        locationName: data.locationName,
        status: 'READY',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return existing;
    }

    const terminal = await this.prisma.posTerminal.create({
      data: {
        organizationId: data.organizationId,
        name: data.terminalName,
        locationName: data.locationName,
        status: 'READY',
        hardwareConfig: data.hardwareConfig ?? {},
        lastSyncAt: new Date(),
      },
    });
    this.logger.log(`Terminal initialized: ${terminal.id}`);
    return terminal;
  }

  async startCashierSession(terminalId: string, cashierId: string, openingCash = 0) {
    const active = await this.prisma.posCashierSession.findFirst({
      where: { terminalId, cashierId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (active) {
      const meta = (active.metadata as Record<string, unknown>) || {};
      return {
        sessionId: active.id,
        status: 'ACTIVE',
        startedAt: active.startedAt,
        openingCash: Number(meta.openingCash ?? openingCash),
        resumed: true,
      };
    }

    const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new BadRequestException('Terminal not found');

    const session = await this.prisma.posCashierSession.create({
      data: {
        terminalId,
        cashierId,
        status: 'ACTIVE',
        metadata: {
          openingCash,
          transactionCount: 0,
        },
      },
    });

    await this.prisma.cashierShift.create({
      data: {
        userId: cashierId,
        organizationId: terminal.organizationId,
        openingCash: new Decimal(openingCash),
        metadata: { posSessionId: session.id, terminalId },
      },
    });

    return {
      sessionId: session.id,
      status: 'ACTIVE',
      startedAt: session.startedAt,
      openingCash,
      resumed: false,
    };
  }

  async quickCheckout(
    terminalId: string,
    sessionId: string,
    data: {
      eventId: string;
      offerId: string;
      quantity?: number;
      seatIds?: string[];
      paymentMethod: 'CASH' | 'CARD' | 'CHECK' | 'COMP';
      discountCode?: string;
      discountPercent?: number;
      cashierId?: string;
      buyerName?: string;
      buyerEmail?: string;
      buyerPhone?: string;
      isComp?: boolean;
      compReason?: string;
      managerPin?: string;
      clientSaleId?: string;
      holdIds?: string[];
    },
  ) {
    const startTime = Date.now();
    const isComp = data.isComp || data.paymentMethod === 'COMP';

    if (isComp) {
      const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
      if (!terminal) throw new BadRequestException('Terminal not found');
      await this.assertManagerPin(terminal.organizationId, data.managerPin);
    }

    let holds: { holds: { id: string }[]; expiresAt: Date };
    if (data.holdIds?.length) {
      const existing = await this.prisma.seatHold.findMany({
        where: { id: { in: data.holdIds }, status: 'ACTIVE' },
      });
      if (existing.length !== data.holdIds.length) {
        throw new BadRequestException('Some holds expired or missing');
      }
      holds = { holds: existing, expiresAt: existing[0]?.expiresAt ?? new Date() };
    } else if (data.seatIds?.length) {
      holds = await this.inventory.createHold({
        eventId: data.eventId,
        offerId: data.offerId,
        seatIds: data.seatIds,
        sessionId,
        channel: SalesChannel.TAQUILLA,
        cashierId: data.cashierId,
      });
    } else {
      const qty = data.quantity ?? 1;
      holds = await this.inventory.createHold({
        eventId: data.eventId,
        offerId: data.offerId,
        quantity: qty,
        sessionId,
        channel: SalesChannel.TAQUILLA,
        cashierId: data.cashierId,
      });
    }

    const buyerName = data.buyerName?.trim() || (isComp ? `Comp · ${data.compReason || 'house'}` : 'Taquilla');
    const buyerEmail =
      data.buyerEmail?.trim() || `taquilla+${terminalId}@pos.boletera.local`;

    const idempotencyKey =
      data.clientSaleId || `pos-${sessionId}-${data.eventId}-${Date.now()}`;

    const order = await this.orders.createOrder({
      eventId: data.eventId,
      offerId: data.offerId,
      holdIds: holds.holds.map((h) => h.id),
      buyerName,
      buyerEmail,
      buyerPhone: data.buyerPhone,
      paymentMethod: isComp ? 'COMP' : data.paymentMethod === 'CHECK' ? 'CASH' : data.paymentMethod,
      promotionCode: data.discountCode,
      channel: SalesChannel.TAQUILLA,
      cashierId: data.cashierId,
      idempotencyKey,
      isComp,
      compReason: data.compReason,
      posOps: {
        clientSaleId: data.clientSaleId,
        terminalId,
        sessionId,
        seatIds: data.seatIds,
        discountPercent: data.discountPercent,
      },
    });
    if (!order) throw new BadRequestException('No se pudo crear la orden');

    const processingTime = (Date.now() - startTime) / 1000;
    this.logger.log(`POS checkout ${processingTime.toFixed(2)}s → ${order.publicId}`);

    return {
      orderId: order.id,
      publicId: order.publicId,
      total: Number(order.totalAmount),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      quantity: data.seatIds?.length ?? data.quantity ?? holds.holds.length,
      processingTime: `${processingTime.toFixed(2)}s`,
      paymentMethod: isComp ? 'COMP' : data.paymentMethod,
      status: order.status,
      holdExpiresAt: holds.expiresAt,
      isComp,
    };
  }

  async createPosHold(data: {
    terminalId: string;
    sessionId: string;
    eventId: string;
    offerId?: string;
    seatIds?: string[];
    quantity?: number;
    cashierId?: string;
  }) {
    const result = await this.inventory.createHold({
      eventId: data.eventId,
      offerId: data.offerId,
      seatIds: data.seatIds,
      quantity: data.quantity,
      sessionId: data.sessionId,
      channel: SalesChannel.TAQUILLA,
      cashierId: data.cashierId,
    });
    return {
      holdIds: result.holds.map((h) => h.id),
      expiresAt: result.expiresAt,
      ttlSeconds: Math.max(0, Math.floor((+result.expiresAt - Date.now()) / 1000)),
    };
  }

  async releaseHolds(holdIds: string[]) {
    for (const id of holdIds) {
      try {
        await this.inventory.releaseHold(id);
      } catch {
        /* already released */
      }
    }
    return { released: holdIds.length };
  }

  /** @deprecated Prefer checkout which completes CASH/CARD in one step */
  async processPayment(
    orderId: string,
    data: { method: 'CASH' | 'CARD' | 'CHECK'; amount: number; cardDetails?: { lastFour: string; brand: string } },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Order not found');
    return {
      paymentId: order.paymentId,
      status: order.status,
      amount: data.amount,
      legacy: true,
      note: 'Use POST /taquilla/checkout — payment is captured during order creation',
    };
  }

  async generateReceipt(orderId: string, terminalId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        items: { include: { tickets: true } },
      },
    });
    if (!order) throw new BadRequestException('Order not found');

    return {
      receiptNumber: `RCP-${order.publicId}`,
      orderId: order.id,
      publicId: order.publicId,
      timestamp: new Date().toISOString(),
      terminalId,
      eventName: order.event.title,
      quantity: order.items.reduce((s, i) => s + i.quantity, 0),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      total: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
      ticketCodes: order.items.flatMap((item) =>
        item.tickets.map((t) => ({
          barcode: t.code,
          seatInfo: [t.section, t.row, t.seatNumber].filter(Boolean).join('-') || 'GA',
        })),
      ),
    };
  }

  async scanBarcode(_terminalId: string, barcode: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        OR: [{ code: barcode }, { id: barcode }],
      },
      include: {
        event: { select: { title: true } },
        orderItem: {
          include: {
            order: {
              select: {
                id: true,
                publicId: true,
                paymentMethod: true,
                totalAmount: true,
                status: true,
                cashierId: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      const order = await this.prisma.order.findFirst({
        where: {
          OR: [{ publicId: barcode }, { id: barcode }],
        },
        include: {
          event: { select: { title: true } },
          items: { include: { tickets: true } },
        },
      });
      if (!order) throw new BadRequestException('Ticket or order not found');
      const first = order.items.flatMap((i) => i.tickets)[0];
      return {
        ticketId: first?.id,
        status: order.status,
        eventId: order.eventId,
        eventTitle: order.event.title,
        seatInfo: 'ORDER',
        valid: order.status === 'COMPLETED',
        orderId: order.id,
        publicId: order.publicId,
        paymentMethod: order.paymentMethod,
        total: Number(order.totalAmount),
        tickets: order.items.flatMap((i) =>
          i.tickets.map((t) => ({
            code: t.code,
            status: t.status,
            seatInfo: [t.section, t.row, t.seatNumber].filter(Boolean).join('-') || 'GA',
          })),
        ),
      };
    }

    return {
      ticketId: ticket.id,
      status: ticket.status,
      eventId: ticket.eventId,
      eventTitle: ticket.event.title,
      seatInfo: [ticket.section, ticket.row, ticket.seatNumber].filter(Boolean).join('-') || 'GA',
      valid: ticket.status === 'SOLD',
      orderId: ticket.orderItem?.order?.id,
      publicId: ticket.orderItem?.order?.publicId,
      paymentMethod: ticket.orderItem?.order?.paymentMethod,
      total: ticket.orderItem?.order ? Number(ticket.orderItem.order.totalAmount) : undefined,
    };
  }

  async voidOrder(data: {
    orderId: string;
    sessionId?: string;
    cashierId?: string;
    reason?: string;
    managerPin?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { items: { include: { tickets: true } } },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.channel !== SalesChannel.TAQUILLA) {
      throw new ForbiddenException('Only taquilla orders can be voided here');
    }
    if (data.cashierId && order.cashierId && order.cashierId !== data.cashierId) {
      throw new ForbiddenException('Order belongs to another cashier');
    }
    if (order.status !== 'COMPLETED' && order.status !== 'PENDING') {
      throw new BadRequestException(`Cannot void order in status ${order.status}`);
    }

    await this.assertManagerPin(order.organizationId, data.managerPin);

    if (data.sessionId) {
      const session = await this.prisma.posCashierSession.findUnique({
        where: { id: data.sessionId },
      });
      if (!session || session.status !== 'ACTIVE') {
        throw new BadRequestException('Active session required to void');
      }
      if (order.createdAt < session.startedAt) {
        throw new BadRequestException('Can only void sales from the current shift');
      }
    }

    const nextStatus = order.status === 'COMPLETED' ? 'REFUNDED' : 'CANCELLED';

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: nextStatus },
      });
      for (const item of order.items) {
        for (const ticket of item.tickets) {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { status: 'AVAILABLE', orderItemId: null },
          });
        }
        if (item.offerId) {
          await tx.offer.update({
            where: { id: item.offerId },
            data: {
              soldQuantity: { decrement: item.quantity },
              remainingQuantity: { increment: item.quantity },
            },
          });
        }
      }
      if (order.status === 'COMPLETED' && Number(order.totalAmount) > 0) {
        await tx.refund.create({
          data: {
            orderId: order.id,
            amount: order.totalAmount,
            reason: 'CUSTOMER_CHANGED_MIND',
            status: 'COMPLETED',
            notes: data.reason || 'Void desde taquilla',
            requestedBy: data.cashierId || 'taquilla',
            processedAt: new Date(),
          },
        });
      }
    });

    this.logger.log(`POS void ${order.publicId}: ${data.reason || 'void'}`);
    return { orderId: order.id, publicId: order.publicId, status: nextStatus };
  }

  async syncInventory(terminalId: string, eventId: string) {
    const availability = await this.inventory.getAvailability(eventId);
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: {
        lastSyncAt: new Date(),
        cacheMetadata: availability,
      },
    });
    return availability;
  }

  async enableOfflineMode(terminalId: string) {
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: { offlineMode: true },
    });
    return { mode: 'OFFLINE', status: 'QUEUED' };
  }

  async syncOfflineTransactions(
    terminalId: string,
    transactions: Array<{ checkoutData: unknown; sessionId: string; clientSaleId?: string }>,
  ) {
    const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new BadRequestException('Terminal not found');

    let synced = 0;
    const failed: string[] = [];
    for (const txn of transactions) {
      try {
        const data = txn.checkoutData as {
          eventId: string;
          offerId: string;
          quantity?: number;
          seatIds?: string[];
          paymentMethod: 'CASH' | 'CARD' | 'COMP';
          buyerName?: string;
          buyerEmail?: string;
          buyerPhone?: string;
          clientSaleId?: string;
        };
        const clientSaleId = (txn.clientSaleId || data.clientSaleId)?.trim() || undefined;
        if (!clientSaleId) {
          failed.push('offline sale missing clientSaleId');
          continue;
        }
        // Durable unique (organizationId, clientSaleId) — not a last-N JSON scan.
        const existing = await this.prisma.order.findUnique({
          where: {
            organizationId_clientSaleId: {
              organizationId: terminal.organizationId,
              clientSaleId,
            },
          },
          select: { id: true },
        });
        if (existing) {
          synced++;
          continue;
        }
        await this.quickCheckout(terminalId, txn.sessionId, {
          ...data,
          clientSaleId,
        });
        synced++;
      } catch (e) {
        // Race: another sync created the same sale between findUnique and create.
        const msg = (e as Error).message || '';
        const clientSaleId =
          (txn.clientSaleId ||
            (txn.checkoutData as { clientSaleId?: string } | undefined)?.clientSaleId)?.trim() ||
          undefined;
        if (clientSaleId && this.isClientSaleConflict(e)) {
          const dup = await this.prisma.order.findUnique({
            where: {
              organizationId_clientSaleId: {
                organizationId: terminal.organizationId,
                clientSaleId,
              },
            },
            select: { id: true },
          });
          if (dup) {
            synced++;
            continue;
          }
        }
        failed.push(msg);
        this.logger.error(`Offline sync failed: ${msg}`);
      }
    }
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: { offlineMode: false, lastSyncAt: new Date() },
    });
    return { synced, failed: failed.length, errors: failed, mode: 'ONLINE' as const };
  }

  async getSessionSummary(sessionId: string) {
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new BadRequestException('Session not found');

    const meta = (session.metadata as Record<string, unknown>) || {};
    const openingCash = Number(meta.openingCash ?? 0);
    const cashDrops = (Array.isArray(meta.cashDrops) ? meta.cashDrops : []) as Array<{
      amount: number;
    }>;
    const dropsTotal = cashDrops.reduce((s, d) => s + Number(d.amount || 0), 0);

    const orders = await this.prisma.order.findMany({
      where: {
        channel: SalesChannel.TAQUILLA,
        status: 'COMPLETED',
        createdAt: { gte: session.startedAt },
        cashierId: session.cashierId,
      },
      include: {
        event: { select: { title: true } },
        items: { select: { quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let cashSales = 0;
    let cardSales = 0;
    let compCount = 0;
    const byMethod: Record<string, number> = {};

    for (const o of orders) {
      const ops = (o as { posOps?: { isComp?: boolean } }).posOps;
      if (ops?.isComp || Number(o.totalAmount) === 0) {
        compCount += 1;
        continue;
      }
      const m = o.paymentMethod;
      const amt = Number(o.totalAmount);
      byMethod[m] = (byMethod[m] ?? 0) + amt;
      if (m === 'CASH') cashSales += amt;
      if (m === 'CARD') cardSales += amt;
    }

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const expectedCash = openingCash + cashSales - dropsTotal;

    return {
      totalTransactions: orders.length,
      totalRevenue,
      byMethod,
      cashSales,
      cardSales,
      compCount,
      openingCash,
      cashDrops,
      dropsTotal,
      expectedCash,
      startTime: session.startedAt,
      endTime: new Date(),
      recentSales: orders.slice(0, 12).map((o) => ({
        orderId: o.id,
        publicId: o.publicId,
        eventTitle: o.event.title,
        total: Number(o.totalAmount),
        paymentMethod: o.paymentMethod,
        quantity: o.items.reduce((s, i) => s + i.quantity, 0),
        createdAt: o.createdAt.toISOString(),
        isComp: Boolean((o as { posOps?: { isComp?: boolean } }).posOps?.isComp),
      })),
    };
  }

  async endCashierSession(
    sessionId: string,
    cashierId: string,
    closingCashCounted?: number,
    managerPin?: string,
  ) {
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: sessionId },
      include: { terminal: true },
    });
    if (!session) throw new BadRequestException('Session not found');

    const summary = await this.getSessionSummary(sessionId);
    const counted =
      closingCashCounted !== undefined && Number.isFinite(closingCashCounted)
        ? closingCashCounted
        : summary.expectedCash;
    const variance = counted - summary.expectedCash;

    if (Math.abs(variance) > 50) {
      await this.assertManagerPin(session.terminal.organizationId, managerPin);
    }

    const report = {
      sessionId,
      cashierId,
      startTime: session.startedAt,
      endTime: new Date().toISOString(),
      totalTransactions: summary.totalTransactions,
      totalRevenue: summary.totalRevenue,
      byMethod: summary.byMethod,
      cashSales: summary.cashSales,
      cardSales: summary.cardSales,
      compCount: summary.compCount,
      openingCash: summary.openingCash,
      dropsTotal: summary.dropsTotal,
      expectedCash: summary.expectedCash,
      closingCashCounted: counted,
      variance,
      zReport: true,
      status: 'CLOSED',
    };

    await this.prisma.posCashierSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', endedAt: new Date(), metadata: report },
    });

    const shift = await this.prisma.cashierShift.findFirst({
      where: { userId: cashierId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (shift) {
      await this.prisma.cashierShift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          closingCash: new Decimal(counted),
          totalSales: new Decimal(summary.totalRevenue),
          metadata: {
            ...(typeof shift.metadata === 'object' && shift.metadata ? shift.metadata : {}),
            ...report,
          },
        },
      });
    }

    return report;
  }

  async willcallLookup(q: string, organizationId?: string) {
    const needle = q.trim();
    if (!needle) throw new BadRequestException('Query required');

    const orders = await this.prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        ...(organizationId ? { organizationId } : {}),
        OR: [
          { publicId: { contains: needle, mode: 'insensitive' } },
          { buyerEmail: { contains: needle, mode: 'insensitive' } },
          { buyerName: { contains: needle, mode: 'insensitive' } },
          { items: { some: { tickets: { some: { code: needle } } } } },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        items: { include: { tickets: { select: { id: true, code: true, status: true, section: true, row: true, seatNumber: true } } } },
      },
    });

    return orders.map((o) => {
      const ops = ((o as { posOps?: Record<string, unknown> }).posOps || {}) as {
        pickedUpAt?: string;
        pickedUpBy?: string;
      };
      return {
        orderId: o.id,
        publicId: o.publicId,
        buyerName: o.buyerName,
        buyerEmail: o.buyerEmail,
        total: Number(o.totalAmount),
        eventTitle: o.event.title,
        eventStartsAt: o.event.startsAt,
        channel: o.channel,
        pickedUpAt: ops.pickedUpAt || null,
        pickedUpBy: ops.pickedUpBy || null,
        tickets: o.items.flatMap((i) =>
          i.tickets.map((t) => ({
            code: t.code,
            status: t.status,
            seatInfo: [t.section, t.row, t.seatNumber].filter(Boolean).join('-') || 'GA',
          })),
        ),
      };
    });
  }

  async willcallFulfill(orderId: string, cashierId: string, terminalId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'COMPLETED') {
      throw new BadRequestException('Completed order required');
    }
    const prev = ((order as { posOps?: Record<string, unknown> }).posOps || {}) as Record<
      string,
      unknown
    >;
    const posOps = {
      ...prev,
      pickedUpAt: new Date().toISOString(),
      pickedUpBy: cashierId,
      pickupTerminalId: terminalId,
    };
    await this.prisma.order.update({
      where: { id: orderId },
      data: { posOps } as never,
    });
    return { orderId, publicId: order.publicId, ...posOps };
  }

  async exchange(data: {
    orderId: string;
    sessionId: string;
    terminalId: string;
    cashierId: string;
    newOfferId?: string;
    newSeatIds?: string[];
    quantity?: number;
    paymentMethod: 'CASH' | 'CARD';
    managerPin?: string;
  }) {
    const old = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { items: true, event: true },
    });
    if (!old || old.status !== 'COMPLETED') {
      throw new BadRequestException('Completed order required');
    }
    await this.assertManagerPin(old.organizationId, data.managerPin);

    await this.voidOrder({
      orderId: old.id,
      sessionId: data.sessionId,
      cashierId: data.cashierId,
      reason: 'Exchange / upgrade',
      managerPin: data.managerPin,
    });

    const offerId = data.newOfferId || old.items[0]?.offerId;
    if (!offerId) throw new BadRequestException('Offer required for exchange');

    const result = await this.quickCheckout(data.terminalId, data.sessionId, {
      eventId: old.eventId,
      offerId,
      seatIds: data.newSeatIds,
      quantity: data.quantity || data.newSeatIds?.length || old.items.reduce((s, i) => s + i.quantity, 0),
      paymentMethod: data.paymentMethod,
      cashierId: data.cashierId,
      buyerName: old.buyerName,
      buyerEmail: old.buyerEmail,
      buyerPhone: old.buyerPhone || undefined,
      clientSaleId: `exch-${old.id}-${Date.now()}`,
    });

    return {
      ...result,
      exchangedFrom: old.publicId,
      previousTotal: Number(old.totalAmount),
      delta: result.total - Number(old.totalAmount),
    };
  }

  async addCashDrop(
    sessionId: string,
    amount: number,
    cashierId: string,
    note?: string,
    managerPin?: string,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid drop amount');
    }
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: sessionId },
      include: { terminal: true },
    });
    if (!session || session.status !== 'ACTIVE') {
      throw new BadRequestException('Active session required');
    }
    await this.assertManagerPin(session.terminal.organizationId, managerPin);
    const meta = (session.metadata as Record<string, unknown>) || {};
    const cashDrops = Array.isArray(meta.cashDrops) ? [...(meta.cashDrops as object[])] : [];
    cashDrops.push({
      amount,
      note: note || '',
      cashierId,
      at: new Date().toISOString(),
    });
    await this.prisma.posCashierSession.update({
      where: { id: sessionId },
      data: { metadata: { ...meta, cashDrops } },
    });
    return this.getSessionSummary(sessionId);
  }

  async setManagerPin(organizationId: string, pin: string, currentPin?: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new BadRequestException('Organization not found');
    const settings = ((org as { settings?: Record<string, unknown> }).settings || {}) as {
      managerPinHash?: string;
    };
    if (settings.managerPinHash) {
      await this.assertManagerPin(organizationId, currentPin);
    }
    const hash = this.hashPin(pin);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...settings, managerPinHash: hash } } as never,
    });
    return { ok: true };
  }

  async verifyManagerPin(organizationId: string, pin: string) {
    await this.assertManagerPin(organizationId, pin);
    return { ok: true };
  }

  async handoff(data: {
    sessionId: string;
    fromCashierId: string;
    toCashierId: string;
    openingCash?: number;
    closingCashCounted?: number;
    managerPin?: string;
  }) {
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: data.sessionId },
      include: { terminal: true },
    });
    if (!session) throw new BadRequestException('Session not found');
    await this.assertManagerPin(session.terminal.organizationId, data.managerPin);

    const closed = await this.endCashierSession(
      data.sessionId,
      data.fromCashierId,
      data.closingCashCounted,
      data.managerPin,
    );

    const next = await this.startCashierSession(
      session.terminalId,
      data.toCashierId,
      data.openingCash ?? closed.expectedCash,
    );

    return { closed, next };
  }

  async listZReports(organizationId: string, take = 30) {
    const terminals = await this.prisma.posTerminal.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const ids = terminals.map((t) => t.id);
    const sessions = await this.prisma.posCashierSession.findMany({
      where: { terminalId: { in: ids }, status: 'CLOSED' },
      orderBy: { endedAt: 'desc' },
      take,
    });
    return sessions.map((s) => ({
      sessionId: s.id,
      terminalId: s.terminalId,
      terminalName: terminals.find((t) => t.id === s.terminalId)?.name,
      cashierId: s.cashierId,
      endedAt: s.endedAt,
      report: s.metadata,
    }));
  }

  private hashPin(pin: string) {
    return createHash('sha256').update(`boletera-mgr:${pin}`).digest('hex');
  }

  private isClientSaleConflict(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = e.meta?.target;
      const hay = Array.isArray(target) ? target.join(',') : String(target ?? '');
      return hay.includes('clientSaleId') || hay.includes('idempotencyKey');
    }
    // OrdersService may surface the race as ConflictException after catching P2002.
    const msg = e instanceof Error ? e.message : '';
    return /idempotenc|clientSaleId|ya existe una orden/i.test(msg);
  }

  private async assertManagerPin(organizationId: string, pin?: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new BadRequestException('Organization not found');
    const settings = ((org as { settings?: { managerPinHash?: string } }).settings ||
      {}) as { managerPinHash?: string };
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !settings.managerPinHash) {
      throw new ForbiddenException(
        'Configura el PIN de gerente en Ajustes antes de autorizar retiros o cierres.',
      );
    }
    // Demo / first-run only outside production
    const expected = settings.managerPinHash || this.hashPin('2468');
    if (!pin || this.hashPin(pin) !== expected) {
      throw new ForbiddenException('PIN de gerente inválido');
    }
  }

  async getTerminalAnalytics(terminalId: string, period: 'TODAY' | 'WEEK' | 'MONTH') {
    const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new BadRequestException('Terminal not found');

    const now = new Date();
    let since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'WEEK') since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (period === 'MONTH') since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.posCashierSession.findMany({
      where: { terminalId },
      select: { cashierId: true },
    });
    const cashierIds = [...new Set(sessions.map((s) => s.cashierId))];

    const orders = await this.prisma.order.findMany({
      where: {
        channel: SalesChannel.TAQUILLA,
        createdAt: { gte: since },
        status: 'COMPLETED',
        ...(cashierIds.length ? { cashierId: { in: cashierIds } } : {}),
      },
    });

    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
    return {
      terminalId,
      terminalName: terminal.name,
      period,
      transactions: orders.length,
      totalRevenue,
      averageTransactionValue: orders.length ? totalRevenue / orders.length : 0,
    };
  }
}
