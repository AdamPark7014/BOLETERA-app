import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VenueLayoutModule } from '../venue-layout/venue-layout.module';
import { EventPublishValidationService } from './event-publish-validation.service';

@Module({
  imports: [PrismaModule, forwardRef(() => VenueLayoutModule)],
  providers: [EventPublishValidationService],
  exports: [EventPublishValidationService],
})
export class EventPublishValidationModule {}
