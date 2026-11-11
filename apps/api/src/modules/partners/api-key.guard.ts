import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PartnersService } from './partners.service';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';
export const RequireApiScopes = (...scopes: string[]) => SetMetadata(API_KEY_SCOPES_KEY, scopes);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private partners: PartnersService,
    private reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header =
      (req.headers['x-api-key'] as string | undefined) ||
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.toLowerCase().startsWith('bearer blk_')
        ? req.headers.authorization.slice(7).trim()
        : undefined);

    if (!header) {
      throw new UnauthorizedException('API key required (X-Api-Key or Bearer blk_…)');
    }

    const key = await this.partners.validateApiKey(header);
    if (!key) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    const required = this.reflector.getAllAndOverride<string[]>(API_KEY_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length) {
      const scopes = key.scopes ?? [];
      const ok = required.every((s) => scopes.includes(s) || scopes.includes('*'));
      if (!ok) {
        throw new ForbiddenException(`API key missing scopes: ${required.join(', ')}`);
      }
    }

    req.apiKey = key;
    req.partnerOrganization = key.organization;
    req.organizationId = key.organizationId;
    return true;
  }
}
