import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { EventPublishValidationModule } from '../event-management/event-publish-validation.module';
import { VenueLayoutService } from './venue-layout.service';
import { VenueLayoutController, EventPublishController } from './venue-layout.controller';

@Module({
  // `forwardRef` en el par con EventPublishValidationModule: la validacion
  // inyecta VenueLayoutService y este controlador inyecta la validacion. Sin
  // esto, uno de los dos es `undefined` al cargar y el API no arranca — y
  // compila igual, porque TypeScript no ve los ciclos de require.
  imports: [
    AuthModule,
    PrismaModule,
    ChannelManagementModule,
    forwardRef(() => EventPublishValidationModule),
  ],
  controllers: [VenueLayoutController, EventPublishController],
  providers: [VenueLayoutService],
  exports: [VenueLayoutService],
})
export class VenueLayoutModule {}


