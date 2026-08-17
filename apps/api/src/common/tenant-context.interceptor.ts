import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../modules/auth/auth.types';
import { TenantContextService } from './tenant-context.service';

interface TenantRequest {
  user?: AuthenticatedUser;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const user = request.user;
    const privileged = user?.role === 'SUPER_ADMIN';
    const requestedOrganizations = this.requestedOrganizations(request);
    if (
      user &&
      !privileged &&
      requestedOrganizations.some((organizationId) => organizationId !== user.organizationId)
    ) {
      throw new ForbiddenException('Organization access denied');
    }
    return this.tenantContext.run(
      {
        organizationId: user?.organizationId,
        userId: user?.sub,
        privileged,
      },
      () => next.handle(),
    );
  }

  private requestedOrganizations(request: TenantRequest): string[] {
    const candidates = [
      request.params?.organizationId,
      request.params?.orgId,
      request.query?.organizationId,
      request.query?.orgId,
      request.body?.organizationId,
      request.body?.orgId,
    ];
    return candidates.filter((value): value is string => typeof value === 'string' && value !== '');
  }
}
