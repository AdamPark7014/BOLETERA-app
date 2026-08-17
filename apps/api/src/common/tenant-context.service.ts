import { AsyncLocalStorage } from 'async_hooks';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

export interface TenantContext {
  organizationId?: string;
  userId?: string;
  privileged: boolean;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): TenantContext {
    return this.storage.getStore() ?? { privileged: false };
  }

  requireOrganization(): string {
    const context = this.current();
    if (!context.organizationId || context.privileged) {
      throw new ForbiddenException('A tenant-scoped organization is required');
    }
    return context.organizationId;
  }

  /**
   * Organization the current request may read/write.
   *
   * `SUPER_ADMIN` (privileged) must name the tenant explicitly (or carry one on
   * the token). Everyone else is pinned via `requireOrganization()`.
   */
  resolveOrganization(requested?: string): string {
    const context = this.current();
    if (context.privileged) {
      const organizationId = requested ?? context.organizationId;
      if (!organizationId) {
        throw new BadRequestException(
          'organizationId is required for cross-tenant operators',
        );
      }
      return organizationId;
    }
    const organizationId = this.requireOrganization();
    if (requested) this.assertOrganization(requested);
    return organizationId;
  }

  assertOrganization(organizationId: string): void {
    const context = this.current();
    if (!context.privileged && context.organizationId !== organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  /**
   * After an id-based resource load, deny foreign tenants with 403 (not 404).
   * Privileged callers must still match the organization resolved for the request.
   */
  assertResourceOrganization(
    resourceOrganizationId: string,
    resolvedOrganizationId: string,
  ): void {
    this.assertOrganization(resourceOrganizationId);
    if (resourceOrganizationId !== resolvedOrganizationId) {
      throw new ForbiddenException('Organization access denied');
    }
  }
}
