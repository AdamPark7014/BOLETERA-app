import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';

const TEAM_ROLES: UserRole[] = [
  UserRole.PROMOTER,
  UserRole.VENUE_MANAGER,
  UserRole.ADMIN,
  UserRole.TAQUILLA,
  UserRole.SCANNER,
];

@Injectable()
export class OrganizationService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getOrganization(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        tenantTheme: true,
        _count: { select: { events: true, venues: true, users: true, orders: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateOrganization(
    orgId: string,
    data: Partial<{
      name: string;
      description: string;
      website: string;
      email: string;
      phone: string;
      commissionRate: number;
      allowResale: boolean;
      feesInclusive: boolean;
      resaleCommission: number;
    }>,
    actorId?: string,
  ) {
    this.assertRate('commissionRate', data.commissionRate);
    this.assertRate('resaleCommission', data.resaleCommission);
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data,
    });
    await this.audit.log({
      action: 'ORG_UPDATED',
      entityType: 'Organization',
      entityId: orgId,
      organizationId: orgId,
      userId: actorId,
      metadata: data as Record<string, unknown>,
    });
    return org;
  }

  /** Tasa 0–1. La comisión de reventa se guarda; el cobro del anuncio no la lee. */
  private assertRate(field: string, value: number | undefined) {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new BadRequestException(`${field} tiene que estar entre 0 y 1`);
    }
  }

  async listTeam(orgId: string) {
    return this.prisma.user.findMany({
      where: { organizationId: orgId, role: { in: TEAM_ROLES } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        lastLogin: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async inviteTeamMember(
    orgId: string,
    data: {
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      password: string;
    },
    actorId?: string,
  ) {
    if (!TEAM_ROLES.includes(data.role)) {
      throw new BadRequestException('Invalid team role');
    }
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        organizationId: orgId,
        provider: 'email',
        active: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      action: 'TEAM_MEMBER_INVITED',
      entityType: 'User',
      entityId: user.id,
      organizationId: orgId,
      userId: actorId,
      metadata: { email: data.email, role: data.role },
    });

    return user;
  }

  async updateTeamMember(
    orgId: string,
    userId: string,
    data: { role?: UserRole; active?: boolean },
    actorId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
    });
    if (!user) throw new NotFoundException('Team member not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
      },
    });

    await this.audit.log({
      action: 'TEAM_MEMBER_UPDATED',
      entityType: 'User',
      entityId: userId,
      organizationId: orgId,
      userId: actorId,
      metadata: data as Record<string, unknown>,
    });

    return updated;
  }

  async getAuditLog(orgId: string, limit = 50, cursor?: string) {
    return this.prisma.auditEvent.findMany({
      where: { organizationId: orgId },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSaasCapabilities(orgId: string) {
    const [org, events, terminals, apiKeys, waitlist, transfers, payouts] =
      await Promise.all([
        this.getOrganization(orgId),
        this.prisma.event.count({ where: { organizationId: orgId } }),
        this.prisma.posTerminal.count({ where: { organizationId: orgId } }),
        this.prisma.apiKey.count({ where: { organizationId: orgId, active: true } }),
        this.prisma.waitlistEntry.count({
          where: { event: { organizationId: orgId }, status: 'PENDING' },
        }),
        this.prisma.ticketTransfer.count({
          where: { ticket: { event: { organizationId: orgId } } },
        }),
        this.prisma.promoterPayout.count({ where: { organizationId: orgId } }),
      ]);

    return {
      organization: { id: org.id, name: org.name, slug: org.slug, verified: org.verified },
      metrics: {
        events,
        terminals,
        apiKeys,
        waitlistPending: waitlist,
        transfers,
        payouts,
      },
      modules: {
        multiTenant: true,
        seatMaps: true,
        posTaquilla: terminals > 0,
        resale: org.allowResale,
        dynamicPricing: true,
        fraud: true,
        campaigns: true,
        channels: true,
        reporting: true,
        waitlist: true,
        ticketTransfer: true,
        apiPartners: true,
        auditLog: true,
        teamManagement: true,
        banortePayments: true,
        settlements: payouts > 0,
        cfdiSandbox: true,
        partnerApiKeys: true,
      },
      roadmap: [
        { id: 'cfdi', label: 'Facturación CFDI 4.0', status: 'partial', priority: 'high', note: 'Sandbox stamp live; PAC production pending' },
        { id: 'sso', label: 'SSO Google / Microsoft', status: 'partial', priority: 'high', note: 'OAuth wired; set GOOGLE_* / MICROSOFT_* env' },
        { id: 'season', label: 'Abonos y temporadas', status: 'partial', priority: 'medium', note: 'CRUD + purchase demo' },
        { id: 'mobile', label: 'Scanner PWA offline', status: 'partial', priority: 'medium', note: 'Admin scanner queues offline scans' },
        { id: 'banorte-prod', label: 'Banorte Payworks producción + refunds API', status: 'partial', priority: 'high' },
        { id: 'settlements', label: 'Liquidaciones SPEI a promotor', status: 'partial', priority: 'high', note: 'PromoterPayout list + mark paid; bank rail pending' },
        { id: 'channels', label: 'Cuotas de canal enforced', status: 'done', priority: 'high' },
      ],
    };
  }
}


