import { ConflictException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { InvitationsService } from './invitations.service';
import { PermissionsService } from './permissions.service';

/**
 * Alias multi-tenant de Azure AD: aceptan CUALQUIER tenant del mundo (o
 * cuentas personales). Con ellos, "iniciar sesión con Microsoft" deja de
 * identificar a la empresa del promotor. Se rechazan explícitamente.
 */
const MICROSOFT_MULTI_TENANT_ALIASES = ['common', 'organizations', 'consumers'];

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private notifications: NotificationService,
    private invitations: InvitationsService,
    private permissions: PermissionsService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.password || !user.active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    // El sello de lastLogin se escribe ANTES de firmar: cualquier escritura
    // sobre User refresca `updatedAt`, y JwtStrategy invalida los tokens
    // emitidos antes de la última modificación (F2-07). Firmar primero haría
    // que el token naciera ya obsoleto.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    const org = user.organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { name: true },
        })
      : null;
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
    const accessToken = this.jwt.sign(payload);
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: org?.name ?? null,
      },
    };
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: UserRole.CUSTOMER,
        provider: 'email',
        active: true,
      },
    });
    return this.login(data.email, data.password);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationId: true,
      },
    });
    if (!user) return null;

    const permissionKeys = await this.permissions.effectivePermissions(user.id, user.role);
    return {
      ...user,
      permissions: Array.from(permissionKeys).sort(),
    };
  }

  /** OAuth providers — configure GOOGLE_* / MICROSOFT_* env vars. */
  getOauthStartUrl(provider: 'google' | 'microsoft', redirectUri: string) {
    if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) throw new UnauthorizedException('GOOGLE_CLIENT_ID not configured');
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', 'openid email profile');
      u.searchParams.set('access_type', 'online');
      u.searchParams.set('prompt', 'select_account');
      return u.toString();
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) throw new UnauthorizedException('MICROSOFT_CLIENT_ID not configured');
    const tenant = this.requireMicrosoftTenant();
    const u = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile User.Read');
    u.searchParams.set('response_mode', 'query');
    return u.toString();
  }

  /**
   * F2-02 — `MICROSOFT_TENANT_ID` es obligatorio y debe apuntar a un tenant
   * concreto. Antes caía por defecto en 'common', lo que dejaba entrar a
   * cualquier cuenta de Azure del planeta.
   */
  private requireMicrosoftTenant(): string {
    const tenant = process.env.MICROSOFT_TENANT_ID?.trim();
    if (!tenant) {
      throw new UnauthorizedException('MICROSOFT_TENANT_ID not configured');
    }
    if (MICROSOFT_MULTI_TENANT_ALIASES.includes(tenant.toLowerCase())) {
      throw new UnauthorizedException(
        'MICROSOFT_TENANT_ID must be a specific tenant id, not a multi-tenant alias',
      );
    }
    return tenant;
  }

  /**
   * El SSO AUTENTICA, NO AUTORIZA.
   *
   * F2-02: antes, cualquier cuenta de Google nueva nacía PROMOTER y cualquier
   * CUSTOMER existente era promovido a PROMOTER al entrar por SSO — registro
   * abierto a un rol con acceso a reembolsos, eventos, campañas y reportes.
   * Ahora toda cuenta nueva nace CUSTOMER sin organización, y la única vía de
   * elevación es una `OrgInvitation` viva para ese correo.
   */
  async loginWithOauth(
    provider: 'google' | 'microsoft',
    code: string,
    redirectUri: string,
  ) {
    const profile =
      provider === 'google'
        ? await this.exchangeGoogle(code, redirectUri)
        : await this.exchangeMicrosoft(code, redirectUri);

    let user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          // Sin privilegios y sin tenant: el panel de administración tiene puerta.
          role: UserRole.CUSTOMER,
          organizationId: null,
          provider,
          providerId: profile.sub,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          active: true,
        },
      });
    } else {
      // Una cuenta dada de baja no vuelve por la puerta del SSO.
      if (!user.active) throw new UnauthorizedException('Account is no longer active');
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          provider,
          providerId: profile.sub,
          emailVerified: true,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          lastLogin: new Date(),
        },
      });
    }

    // Única elevación de rol admitida. Sin invitación viva, el usuario se queda
    // exactamente con el rol que ya tuviera en la base.
    user = await this.invitations.applyPendingInvitation(user);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
    return {
      accessToken: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  private async exchangeGoogle(code: string, redirectUri: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed');
    const tokens = (await tokenRes.json()) as { access_token: string };
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new UnauthorizedException('Google profile failed');
    const p = (await profileRes.json()) as {
      sub: string;
      email: string;
      given_name?: string;
      family_name?: string;
    };
    return {
      sub: p.sub,
      email: p.email.toLowerCase(),
      firstName: p.given_name ?? 'Google',
      lastName: p.family_name ?? 'User',
    };
  }

  private async exchangeMicrosoft(code: string, redirectUri: string) {
    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    // También aquí: el intercambio de código no puede caer en 'common' aunque
    // alguien llame al callback sin haber pasado por getOauthStartUrl().
    const tenant = this.requireMicrosoftTenant();
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );
    if (!tokenRes.ok) throw new UnauthorizedException('Microsoft token exchange failed');
    const tokens = (await tokenRes.json()) as { access_token: string };
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new UnauthorizedException('Microsoft profile failed');
    const p = (await profileRes.json()) as {
      id: string;
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
    };
    const email = (p.mail || p.userPrincipalName || '').toLowerCase();
    if (!email) throw new UnauthorizedException('Microsoft account has no email');
    return {
      sub: p.id,
      email,
      firstName: p.givenName ?? 'Microsoft',
      lastName: p.surname ?? 'User',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always return ok to avoid email enumeration
    if (!user?.password) {
      return { ok: true, message: 'Si el correo existe, enviamos instrucciones.' };
    }

    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hash,
        passwordResetAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const resetUrl = `${webUrl}/login/reset?token=${raw}&email=${encodeURIComponent(user.email)}`;

    await this.notifications.enqueueEmail({
      to: user.email,
      subject: 'Restablecer contraseña — Boletera',
      template: 'password-reset',
      data: { resetUrl, firstName: user.firstName },
    });

    return {
      ok: true,
      message: 'Si el correo existe, enviamos instrucciones.',
      // Dev helper when SMTP missing
      ...(process.env.NODE_ENV !== 'production' ? { devResetUrl: resetUrl } : {}),
    };
  }

  async resetPassword(token: string, email: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        passwordResetToken: hash,
        passwordResetAt: { gt: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password,
        passwordResetToken: null,
        passwordResetAt: null,
      },
    });

    return { ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }
}


