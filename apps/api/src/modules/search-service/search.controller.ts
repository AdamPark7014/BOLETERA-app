import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { TenantService } from '../tenant/tenant.service';
import { pickTenantHost } from '../tenant/tenant-host';

/** Query filters for SQL facet search (not an AI ranking engine). */
export type SearchEventsQuery = {
  q?: string;
  query?: string;
  city?: string;
  category?: string;
  limit?: string;
};

@ApiTags('Search & Discovery')
@Controller('search')
export class SearchController {
  constructor(
    private searchService: SearchService,
    private tenant: TenantService,
  ) {}

  private async resolveOrgId(headers: Record<string, string>): Promise<string | null> {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    return org?.id ?? null;
  }

  @Get('events')
  @ApiOperation({
    summary: 'Search events via SQL filters and simple popularity ranking',
    description:
      'Uses Prisma/SQL contains filters and order counts — not an ML/AI ranking engine. Scoped to tenant host.',
  })
  async searchEvents(
    @Headers() headers: Record<string, string>,
    @Query() filters: SearchEventsQuery,
  ) {
    const orgId = await this.resolveOrgId(headers);
    if (!orgId) return [];
    return await this.searchService.searchEvents({
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
      limit: filters.limit ? Number(filters.limit) : undefined,
      organizationId: orgId,
    });
  }

  @Get('facets')
  @ApiOperation({ summary: 'Get SQL facet counts for filtering (city, category)' })
  async getFacets(
    @Headers() headers: Record<string, string>,
    @Query() filters: SearchEventsQuery,
  ) {
    const orgId = await this.resolveOrgId(headers);
    if (!orgId) return { cities: [], categories: [], priceRange: { min: 0, max: 0 } };
    return await this.searchService.getSearchFacets({
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
      organizationId: orgId,
    });
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete suggestions from event titles (SQL ILIKE)' })
  async getAutocomplete(
    @Headers() headers: Record<string, string>,
    @Query('q') query: string,
  ) {
    const orgId = await this.resolveOrgId(headers);
    if (!orgId) return [];
    return await this.searchService.getAutocomplete(query, orgId);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Events ordered by recent order volume' })
  async getTrending(
    @Headers() headers: Record<string, string>,
    @Query('limit') limit?: number,
  ) {
    const orgId = await this.resolveOrgId(headers);
    if (!orgId) return [];
    return await this.searchService.getTrendingEvents(limit || 10, orgId);
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Heuristic recommendations (same-city / popular)',
    description: 'Deterministic SQL heuristics — not personalized ML. Tenant-scoped.',
  })
  async getRecommendations(
    @Headers() headers: Record<string, string>,
    @Query('userId') userId?: string,
  ) {
    const orgId = await this.resolveOrgId(headers);
    if (!orgId) return [];
    return await this.searchService.getSmartRecommendations(userId, orgId);
  }
}
