import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class PartnersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  private hashKey(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  async createApiKey(
    orgId: string,
    data: { name: string; scopes?: string[]; rateLimit?: number; expiresInDays?: number },
    createdById?: string
  ) {
    const raw = `blk_${randomBytes(24).toString('hex')}`;
    const keyPrefix = raw.slice(0, 12);
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId: orgId,
        name: data.name,
        keyHash: this.hashKey(raw),
        keyPrefix,
        scopes: data.scopes ?? ['read:events', 'read:inventory', 'write:orders'],
        rateLimit: data.rateLimit ?? 1000,
        expiresAt,
        createdById,
      },
    });

    await this.audit.log({
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      organizationId: orgId,
      userId: createdById,
      metadata: { name: data.name, keyPrefix },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      /** Shown once — store securely */
      secret: raw,
    };
  }

  async listApiKeys(orgId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(orgId: string, keyId: string, actorId?: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id: keyId, organizationId: orgId },
    });
    if (!key) throw new NotFoundException('API key not found');

    const updated = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { active: false },
    });

    await this.audit.log({
      action: 'API_KEY_REVOKED',
      entityType: 'ApiKey',
      entityId: keyId,
      organizationId: orgId,
      userId: actorId,
    });

    return updated;
  }

  async validateApiKey(rawKey: string) {
    const hash = this.hashKey(rawKey);
    const key = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash, active: true },
      include: { organization: { select: { id: true, slug: true, name: true } } },
    });
    if (!key) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;

    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return key;
  }
}
