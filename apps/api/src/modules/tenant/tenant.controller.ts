import { Controller, Get, Headers } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { pickTenantHost } from './tenant-host';

@ApiTags('Tenant')
@Controller('tenant')
export class TenantController {
  constructor(private tenant: TenantService) {}

  @Get('current')
  async current(@Headers() headers: Record<string, string>) {
    const org = await this.tenant.resolveByHost(pickTenantHost(headers));
    if (!org) return { error: 'Tenant not found' };
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      theme: org.tenantTheme,
    };
  }
}
