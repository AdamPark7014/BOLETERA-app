import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OrgAccessGuard } from './org-access.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

/** Petición autenticada con el tenant ya resuelto por OrgAccessGuard. */
type ScopedRequest = {
  user: { sub: string; email: string; role: string; organizationId?: string | null };
  scopedOrganizationId?: string | null;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private invitations: InvitationsService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(
    @Body()
    body: { email: string; password: string; firstName: string; lastName: string },
  ) {
    return this.auth.register(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@Request() req: { user: { sub: string } }) {
    return this.auth.me(req.user.sub);
  }

  @Get('oauth/google/start')
  googleStart(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const uri =
      redirectUri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return res.redirect(this.auth.getOauthStartUrl('google', uri));
  }

  @Get('oauth/microsoft/start')
  microsoftStart(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const uri =
      redirectUri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return res.redirect(this.auth.getOauthStartUrl('microsoft', uri));
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { email: string; token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.email, body.password);
  }

  @Post('oauth/google/callback')
  googleCallback(@Body() body: { code: string; redirect_uri?: string }) {
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return this.auth.loginWithOauth('google', body.code, uri);
  }

  @Post('oauth/microsoft/callback')
  microsoftCallback(@Body() body: { code: string; redirect_uri?: string }) {
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return this.auth.loginWithOauth('microsoft', body.code, uri);
  }

  // ==================== INVITACIONES DE ORGANIZACIÓN (F2-02) ====================
  // Única puerta de elevación de rol. `OrgAccessGuard` valida el
  // `organizationId` del cuerpo/query contra el token y publica el tenant en
  // `req.scopedOrganizationId`, que es el que usamos como autoridad.

  @Post('invitations')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite an email to a privileged role in an organization' })
  createInvitation(
    @Request() req: ScopedRequest,
    @Body()
    body: {
      organizationId?: string;
      email: string;
      role: UserRole;
      expiresInDays?: number;
    },
  ) {
    return this.invitations.createInvitation({
      organizationId: req.scopedOrganizationId ?? body.organizationId ?? '',
      email: body.email,
      role: body.role,
      inviterRole: req.user.role,
      inviterId: req.user.sub,
      inviterOrganizationId: req.user.organizationId ?? null,
      expiresInDays: body.expiresInDays,
    });
  }

  @Get('invitations')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invitations for an organization' })
  listInvitations(
    @Request() req: ScopedRequest,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.invitations.listByOrganization(req.scopedOrganizationId ?? organizationId);
  }

  @Delete('invitations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revokeInvitation(@Request() req: ScopedRequest, @Param('id') id: string) {
    // SUPER_ADMIN sin organización en el token revoca en cualquier tenant.
    const scoped = req.user.role === 'SUPER_ADMIN' ? null : req.scopedOrganizationId;
    return this.invitations.revokeInvitation(id, scoped);
  }
}
