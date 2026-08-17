import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Identifica al comprador si trae token, y deja pasar si no (guest checkout).
 *
 * NO CONFIERE AUTORIZACIÓN: deja únicamente `{sub, email}` en `req.user`, sin
 * `role` ni `organizationId`, y no comprueba contra la base que la cuenta siga
 * activa. Por eso nunca debe combinarse con `RolesGuard` ni con
 * `OrgAccessGuard` — con este guard, `user.role` es `undefined` y
 * `OrgAccessGuard` denegaría; para rutas con privilegios se usa `JwtAuthGuard`.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { sub: string; email?: string };
    }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email?: string }>(header.slice(7));
      req.user = { sub: payload.sub, email: payload.email };
    } catch {
      /* guest checkout */
    }
    return true;
  }
}


