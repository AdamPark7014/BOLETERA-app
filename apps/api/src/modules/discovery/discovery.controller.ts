import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import { TenantService } from '../tenant/tenant.service';
import { pickTenantHost } from '../tenant/tenant-host';

@ApiTags('Discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private discovery: DiscoveryService,
    private tenant: TenantService,
  ) {}

  @Get('suggest')
  async suggest(
    @Headers() headers: Record<string, string>,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org || !q?.trim()) return [];
    return this.discovery.suggest({
      orgId: org.id,
      q,
      limit: limit ? parseInt(limit, 10) : 8,
    });
  }

  @Get('facets')
  async facets(@Headers() headers: Record<string, string>) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return { cities: [], categories: [] };
    return this.discovery.facets(org.id);
  }

  @Get('venues')
  async venues(
    @Headers() headers: Record<string, string>,
    @Query('limit') limit?: string,
    @Query('city') city?: string,
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return [];
    return this.discovery.listVenues({
      orgId: org.id,
      limit: limit ? parseInt(limit, 10) : undefined,
      city: city && city !== 'ALL' ? city : undefined,
    });
  }

  @Get('venues/:slug')
  async venueBySlug(
    @Headers() headers: Record<string, string>,
    @Param('slug') slug: string,
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return null;
    return this.discovery.getVenueBySlug(slug, org.id);
  }

  @Get('events')
  async events(
    @Headers() headers: Record<string, string>,
    @Query('q') q?: string,
    @Query('city') city?: string,
    @Query('category') category?: string,
    @Query('venueSlug') venueSlug?: string,
    @Query('when') when?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return [];
    return this.discovery.listEvents({
      orgId: org.id,
      q,
      city: city && city !== 'ALL' ? city : undefined,
      category: category && category !== 'ALL' ? category : undefined,
      venueSlug,
      when,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get('events/:slug')
  getEvent(@Param('slug') slug: string) {
    return this.discovery.getBySlug(slug);
  }

  @Get('site-content')
  async siteContent(@Headers() headers: Record<string, string>) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) {
      const { defaultSiteContent } = await import('@boletera/shared');
      return defaultSiteContent();
    }
    return this.discovery.getSiteContent(org.id);
  }
}
