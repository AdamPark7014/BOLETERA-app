import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async resolveByHost(host: string) {
    const hostname = host.split(':')[0];
    const subdomain = hostname.split('.')[0];
    if (
      subdomain === 'localhost' ||
      subdomain === 'www' ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    ) {
      const demo = await this.prisma.organization.findFirst({
        where: { slug: 'demo-boletera' },
        include: { tenantTheme: true },
      });
      if (demo) return demo;
      return this.prisma.organization.findFirst({ include: { tenantTheme: true } });
    }
    const bySubdomain = await this.prisma.tenantTheme.findFirst({
      where: { OR: [{ subdomain }, { customDomain: hostname }] },
      include: { organization: { include: { tenantTheme: true } } },
    });
    if (bySubdomain) return bySubdomain.organization;
    const bySlug = await this.prisma.organization.findUnique({
      where: { slug: subdomain },
      include: { tenantTheme: true },
    });
    if (bySlug) return bySlug;
    throw new NotFoundException('Tenant not found');
  }
}
