import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FraudSeverity, FraudStatus, FraudType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * F2-11 — Aislamiento multi-inquilino de las señales de fraude.
 *
 * `FraudFlag` NO tiene columna `organizationId` (esquema congelado), así que el
 * tenant se deduce por relación: el evento o el pedido señalado pertenecen a una
 * organización. Un flag sin `eventId` ni `orderId` (p. ej. sólo `userId` o una
 * IP) no es atribuible a ningún promotor: queda reservado a SUPER_ADMIN en
 * lugar de mostrarse a todos, que era el comportamiento anterior.
 */
function organizationScopeFilter(
  organizationId: string | null | undefined,
): Prisma.FraudFlagWhereInput {
  if (!organizationId) return {};
  return {
    OR: [{ event: { organizationId } }, { order: { organizationId } }],
  };
}

interface FraudCheckContext {
  orderId?: string;
  userId?: string;
  eventId?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  buyerEmail?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  paymentMethod?: string;
}

export interface FraudScore {
  score: number; // 0-100
  severity: FraudSeverity;
  flags: Array<{ type: FraudType; weight: number; reason: string }>;
  recommendedAction: 'ALLOW' | 'REVIEW' | 'BLOCK';
}

@Injectable()
export class FraudService {
  private logger = new Logger(FraudService.name);

  private readonly THRESHOLDS = {
    LOW: 30,
    MEDIUM: 50,
    HIGH: 75,
    CRITICAL: 90,
  };

  constructor(private prisma: PrismaService) {}

  // ==================== FRAUD SCORING ====================

  async analyzeFraud(ctx: FraudCheckContext): Promise<FraudScore> {
    const flags = [];
    let totalScore = 0;

    // 1. Velocity check (multiple orders in short time)
    if (ctx.userId) {
      const recentOrders = await this.prisma.order.count({
        where: {
          userId: ctx.userId,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 min
          status: OrderStatus.COMPLETED,
        },
      });
      if (recentOrders > 3) {
        flags.push({
          type: FraudType.HIGH_VELOCITY,
          weight: 15,
          reason: `${recentOrders} orders in last 5 minutes`,
        });
        totalScore += 15;
      }
    }

    // 2. Duplicate purchase detection
    if (ctx.orderId && ctx.eventId && ctx.userId) {
      const duplicates = await this.prisma.order.count({
        where: {
          userId: ctx.userId,
          eventId: ctx.eventId,
          status: OrderStatus.COMPLETED,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (duplicates > 0) {
        flags.push({
          type: FraudType.DUPLICATE_PURCHASE,
          weight: 25,
          reason: 'Duplicate purchase for same event',
        });
        totalScore += 25;
      }
    }

    // 3. Unusual location check
    if (ctx.ipAddress) {
      const locationScore = await this.checkLocationAnomaly(ctx.userId, ctx.ipAddress);
      if (locationScore > 0) {
        flags.push({
          type: FraudType.UNLIKELY_LOCATION,
          weight: locationScore,
          reason: 'Unusual geographic location',
        });
        totalScore += locationScore;
      }
    }

    // 4. Large order amount check
    if (ctx.amount && ctx.amount > 5000) {
      flags.push({
        type: FraudType.SUSPICIOUS_ACTIVITY,
        weight: 10,
        reason: `Large order amount: ${ctx.amount}`,
      });
      totalScore += 10;
    }

    // 5. Device fingerprint analysis
    if (ctx.deviceFingerprint) {
      const deviceScore = await this.analyzeDeviceFingerprint(
        ctx.userId,
        ctx.deviceFingerprint,
      );
      if (deviceScore > 0) {
        flags.push({
          type: FraudType.SUSPICIOUS_ACTIVITY,
          weight: deviceScore,
          reason: 'Suspicious device fingerprint',
        });
        totalScore += deviceScore;
      }
    }

    // 6. Email verification status
    if (ctx.buyerEmail) {
      const user = await this.prisma.user.findUnique({
        where: { email: ctx.buyerEmail },
      });
      if (user && !user.emailVerified) {
        flags.push({
          type: FraudType.SUSPICIOUS_ACTIVITY,
          weight: 5,
          reason: 'Unverified email address',
        });
        totalScore += 5;
      }
    }

    // 7. Declined payment attempts history
    if (ctx.userId) {
      const declinedCount = await this.prisma.order.count({
        where: {
          userId: ctx.userId,
          status: OrderStatus.FAILED,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });
      if (declinedCount >= 3) {
        flags.push({
          type: FraudType.MULTIPLE_DECLINED,
          weight: 20,
          reason: `${declinedCount} declined payment attempts in 7 days`,
        });
        totalScore += 20;
      }
    }

    // Cap score at 100
    totalScore = Math.min(totalScore, 100);

    // Determine severity
    let severity: FraudSeverity;
    if (totalScore >= this.THRESHOLDS.CRITICAL) severity = FraudSeverity.CRITICAL;
    else if (totalScore >= this.THRESHOLDS.HIGH) severity = FraudSeverity.HIGH;
    else if (totalScore >= this.THRESHOLDS.MEDIUM) severity = FraudSeverity.MEDIUM;
    else severity = FraudSeverity.LOW;

    // Determine recommended action
    let recommendedAction: 'ALLOW' | 'REVIEW' | 'BLOCK' = 'ALLOW';
    if (totalScore >= 90) recommendedAction = 'BLOCK';
    else if (totalScore >= 60) recommendedAction = 'REVIEW';

    const result: FraudScore = {
      score: totalScore,
      severity,
      flags,
      recommendedAction,
    };

    this.logger.log(`Fraud score for ${ctx.userId}: ${totalScore} (${severity})`);

    return result;
  }

  // ==================== FLAG CREATION ====================

  async createFlag(data: {
    type: FraudType;
    severity: FraudSeverity;
    score: number;
    reason: string;
    orderId?: string;
    userId?: string;
    eventId?: string;
    ipAddress?: string;
    deviceFingerprint?: string;
    metadata?: Record<string, any>;
  },
  /**
   * Tenant del solicitante cuando el flag llega por HTTP. El motor de checkout
   * (orders.service) llama sin este argumento: ya opera sobre un pedido cuyo
   * tenant validó antes, y no hay usuario al que acotar.
   */
  scopedOrganizationId?: string | null,
  ) {
    if (scopedOrganizationId) {
      await this.assertSubjectBelongsToOrg(scopedOrganizationId, {
        eventId: data.eventId,
        orderId: data.orderId,
      });
    }

    const flag = await this.prisma.fraudFlag.create({
      data: {
        type: data.type,
        severity: data.severity,
        score: data.score,
        reason: data.reason,
        orderId: data.orderId,
        userId: data.userId,
        eventId: data.eventId,
        ipAddress: data.ipAddress,
        deviceFingerprint: data.deviceFingerprint,
        metadata: data.metadata,
        status: FraudStatus.FLAGGED,
      },
    });

    this.logger.warn(`Fraud flag created: ${flag.id} (${data.severity})`);

    // Send alert if critical
    if (data.severity === FraudSeverity.CRITICAL) {
      await this.sendCriticalAlert(flag.id, data);
    }

    return flag;
  }

  // ==================== LOCATION ANOMALY ====================

  private async checkLocationAnomaly(userId: string | undefined, ipAddress: string) {
    if (!userId || !ipAddress) return 0;

    // Deterministic heuristic: compare /24 subnet of current IP vs recent audit IPs
    const recent = await this.prisma.auditEvent.findMany({
      where: {
        userId,
        ipAddress: { not: null },
        createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      select: { ipAddress: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    if (!recent.length) return 0;

    const subnet = (ip: string) => ip.split('.').slice(0, 3).join('.');
    const current = subnet(ipAddress);
    const known = new Set(recent.map((r) => subnet(r.ipAddress!)).filter(Boolean));
    if (known.size > 0 && !known.has(current) && !ipAddress.includes(':')) {
      // New IPv4 /24 relative to history → elevated risk (not random)
      return 12;
    }
    return 0;
  }

  // ==================== DEVICE FINGERPRINT ANALYSIS ====================

  private async analyzeDeviceFingerprint(userId: string | undefined, fingerprint: string) {
    if (!userId) return 0;

    // Check if this is a new device for the user
    const existingDevices = await this.prisma.fraudFlag.count({
      where: {
        userId,
        deviceFingerprint: fingerprint,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });

    // New device = slight risk increase
    if (existingDevices === 0) {
      return 3;
    }

    return 0;
  }

  // ==================== LIST FLAGS ====================

  async listFlags(params: {
    severity?: FraudSeverity;
    status?: FraudStatus;
    limit?: number;
    offset?: number;
    /** Tenant resuelto por el guard. `null` (sólo SUPER_ADMIN) = sin acotar. */
    organizationId?: string | null;
  }) {
    // El límite lo fija el servidor: `?limit=999999` permitía volcar la tabla
    // entera de señales (con email del comprador) en una sola petición.
    const take = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const skip = Math.max(Number(params.offset) || 0, 0);

    return await this.prisma.fraudFlag.findMany({
      where: {
        ...organizationScopeFilter(params.organizationId),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        order: { select: { publicId: true } },
        user: { select: { email: true } },
      },
    });
  }

  // ==================== RESOLVE FLAG ====================

  /**
   * `resolvedBy` es la identidad del JWT, nunca un valor del cuerpo: la
   * atribución de quién cerró una señal es prueba en una disputa con el
   * adquirente y no puede ser autodeclarada por el cliente.
   */
  async resolveFlag(
    flagId: string,
    resolution: string,
    resolvedBy: string,
    scopedOrganizationId?: string | null,
  ) {
    // Comprobación de pertenencia ANTES del update: `update({where:{id}})` sin
    // filtro de tenant deja que el ADMIN de un promotor cierre (y firme) las
    // señales de otro con sólo adivinar el cuid.
    const existing = await this.prisma.fraudFlag.findFirst({
      where: { id: flagId, ...organizationScopeFilter(scopedOrganizationId) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Fraud flag not found');

    const flag = await this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: {
        status: FraudStatus.RESOLVED,
        resolved: true,
        resolution,
        resolvedBy,
        resolvedAt: new Date(),
      },
    });

    this.logger.log(`Fraud flag resolved: ${flagId} by ${resolvedBy}`);
    return flag;
  }

  // ==================== TENANT GUARDS (relaciones) ====================

  /**
   * Verifica que el sujeto señalado (evento y/o pedido) sea del inquilino que
   * escribe. Sin esto un ADMIN podía plantar señales CRITICAL sobre los pedidos
   * de un competidor.
   */
  private async assertSubjectBelongsToOrg(
    organizationId: string,
    subject: { eventId?: string; orderId?: string },
  ) {
    if (subject.eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: subject.eventId },
        select: { organizationId: true },
      });
      if (!event || event.organizationId !== organizationId) {
        throw new ForbiddenException('Organization access denied');
      }
    }
    if (subject.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: subject.orderId },
        select: { organizationId: true },
      });
      if (!order || order.organizationId !== organizationId) {
        throw new ForbiddenException('Organization access denied');
      }
    }
    if (!subject.eventId && !subject.orderId) {
      // Un flag sin sujeto no sería visible ni para quien lo crea (ver
      // organizationScopeFilter): lo rechazamos en vez de dejar huérfanos.
      throw new ForbiddenException('Fraud flag requires an eventId or an orderId');
    }
  }

  // ==================== ALERT SYSTEM ====================

  private async sendCriticalAlert(flagId: string, data: any) {
    // Send alert to admin/fraud team
    this.logger.error(`⚠️ CRITICAL FRAUD ALERT: ${flagId}`);
    this.logger.error(`  Type: ${data.type}`);
    this.logger.error(`  Score: ${data.score}`);
    this.logger.error(`  Reason: ${data.reason}`);

    // In production, integrate with:
    // - Email alerts
    // - Slack/Teams webhooks
    // - PagerDuty for on-call
    // - SMS alerts
  }

  // ==================== KYC/AML CHECKS ====================

  async performKYCCheck(
    userId: string,
    data: {
      fullName: string;
      dateOfBirth: string;
      address: string;
      city: string;
      country: string;
      documentNumber: string;
      documentType: string;
    },
    scopedOrganizationId?: string | null,
  ) {
    // Un comprador no pertenece a ninguna organización (`user.organizationId`
    // es nulo para CUSTOMER): la relación con el promotor es haberle comprado.
    // Sin esta comprobación, cualquier ADMIN podía lanzar KYC —y adjuntar datos
    // de identidad— sobre cualquier usuario de la plataforma con sólo su id.
    if (scopedOrganizationId) {
      const belongs = await this.prisma.user.findFirst({
        where: {
          id: userId,
          OR: [
            { organizationId: scopedOrganizationId },
            { orders: { some: { organizationId: scopedOrganizationId } } },
          ],
        },
        select: { id: true },
      });
      if (!belongs) throw new NotFoundException('User not found');
    }

    this.logger.log(`Performing KYC check for user: ${userId}`);

    // In production, integrate with KYC providers:
    // - Jumio
    // - IDology
    // - Trulioo
    // - Onfido
    //
    // Los datos de `data` (documento, domicilio, fecha de nacimiento) NO se
    // persisten hoy: el `user.update({data:{}})` anterior era una escritura
    // vacía que sólo servía para enumerar ids. Cuando se integre el proveedor,
    // estos campos deben ir cifrados y nunca al log.

    return { status: 'verified', userId };
  }

  // ==================== AML CHECK ====================

  async performAMLCheck(organizationId: string, data: {
    name: string;
    country: string;
  }) {
    this.logger.log(`Performing AML check for organization: ${organizationId}`);

    // In production, integrate with AML services:
    // - OFAC database
    // - UN sanctions list
    // - EU sanctions list
    // - World-Check

    return { status: 'cleared', isWatchlisted: false };
  }
}


