import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionsService } from './permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.sub) throw new ForbiddenException('Authentication required');

    // Mirror RolesGuard: SUPER_ADMIN bypasses permission checks.
    if (user.role === 'SUPER_ADMIN') return true;

    const ok = await this.permissions.hasAllPermissions(user.sub, user.role, required);
    if (!ok) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
