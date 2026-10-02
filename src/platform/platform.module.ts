import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtiesModule } from '../specialties/specialties.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformSubscriptionService } from './platform-subscription.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({
  imports: [PrismaModule, AuthModule, SpecialtiesModule],
  controllers: [PlatformTenantsController],
  providers: [PlatformTenantsService, PlatformSubscriptionService, PlatformAuditService],
  exports: [PlatformTenantsService, PlatformAuditService],
})
export class PlatformModule {}
