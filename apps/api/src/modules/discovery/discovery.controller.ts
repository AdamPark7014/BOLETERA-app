import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import { TenantService } from '../tenant/tenant.service';
import { pickTenantHost } from '../tenant/tenant-host';

/** Cartelera y ficha: CDN/edge 30 s frescos, 120 s stale. */
const PUBLIC_READ_CACHE = 'public, s-maxage=30, stale-while-revalidate=120';

@ApiTags('Discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private discovery: DiscoveryService,
    private tenant: TenantService
  ) {}

  @Get('suggest')
  async suggest(
    @Headers() headers: Record<string, string>,
    @Query('q') q?: string,
    @Query('limit') limit?: string
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
  @Header('Cache-Control', PUBLIC_READ_CACHE)
  async facets(@Headers() headers: Record<string, string>) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return { cities: [], categories: [] };
    return this.discovery.facets(org.id);
  }

  @Get('venues')
  @Header('Cache-Control', PUBLIC_READ_CACHE)
  async venues(
    @Headers() headers: Record<string, string>,
    @Query('limit') limit?: string,
    @Query('city') city?: string
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
  @Header('Cache-Control', PUBLIC_READ_CACHE)
  async venueBySlug(@Headers() headers: Record<string, string>, @Param('slug') slug: string) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return null;
    return this.discovery.getVenueBySlug(slug, org.id);
  }

  @Get('events')
  @Header('Cache-Control', PUBLIC_READ_CACHE)
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
    @Query('cursor') cursor?: string
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
  @Header('Cache-Control', PUBLIC_READ_CACHE)
  async getEvent(@Headers() headers: Record<string, string>, @Param('slug') slug: string) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    // Fail-closed: sin tenant resuelto no se sirve detalle cross-org.
    if (!org?.id) throw new NotFoundException('Event not found');
    return this.discovery.getBySlug(slug, org.id);
  }

  @Get('site-content')
  @Header('Cache-Control', PUBLIC_READ_CACHE)
  async siteContent(@Headers() headers: Record<string, string>) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) {
      const { defaultSiteContent } = await import('@boletera/shared');
      return defaultSiteContent();
    }
    return this.discovery.getSiteContent(org.id);
  }
}