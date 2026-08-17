import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationsService } from './invitations.service';
import { JwtStrategy } from './jwt.strategy';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { OrgAccessGuard } from './org-access.guard';
import { EventOrgAccessGuard } from './event-org-access.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { StreamAuthGuard } from './stream-auth.guard';
import { StreamTicketController } from './stream-ticket.controller';
import { StreamTicketService } from './stream-ticket.service';
import { requireJwtSecret } from './jwt-secret';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: requireJwtSecret(),
      // F2-07: 24 h era una ventana inaceptable para un token sin revocación.
      // Con JwtStrategy releyendo el usuario de la base la revocación ya no
      // depende de la caducidad, pero 2 h acota el daño de un token filtrado.
      // El cast es inevitable: `expiresIn` está tipado como plantilla literal
      // de `ms` ('2h', '30m'...) y process.env sólo nos da `string`.
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRATION || '2h') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController, StreamTicketController],
  providers: [
    AuthService,
    InvitationsService,
    JwtStrategy,
    OptionalJwtAuthGuard,
    OrgAccessGuard,
    EventOrgAccessGuard,
    JwtAuthGuard,
    RolesGuard,
    StreamTicketService,
    StreamAuthGuard,
  ],
  exports: [
    AuthService,
    InvitationsService,
    JwtModule,
    // F2-12: JwtStrategy se exporta porque StreamAuthGuard lo inyecta para
    // reutilizar la resolución de identidad contra la base.
    JwtStrategy,
    OptionalJwtAuthGuard,
    OrgAccessGuard,
    EventOrgAccessGuard,
    JwtAuthGuard,
    RolesGuard,
    StreamTicketService,
    StreamAuthGuard,
  ],
})
export class AuthModule {}
