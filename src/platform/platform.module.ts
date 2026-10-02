import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtiesModule } from '../specialties/specialties.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({
  imports: [PrismaModule, AuthModule, SpecialtiesModule],
  controllers: [PlatformTenantsController],
  providers: [PlatformTenantsService, PlatformAuditService],
  exports: [PlatformTenantsService, PlatformAuditService],
})
export class PlatformModule {}
