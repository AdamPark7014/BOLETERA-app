import { Injectable } from '@nestjs/common';
import { PrismaService } from '../modules/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    action: string;
    entityType: string;
    entityId?: string;
    organizationId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        organizationId: params.organizationId,
        userId: params.userId,
        metadata: params.metadata as object,
        ipAddress: params.ipAddress,
      },
    });
  }
}
