import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtyCatalogController } from './specialty-catalog.controller';
import { SpecialtyCatalogService } from './specialty-catalog.service';
import { SpecialtiesController } from './specialties.controller';
import { SpecialtiesService } from './specialties.service';
import { TenantSpecialtiesService } from './tenant-specialties.service';

@Module({
  imports: [PrismaModule],
  controllers: [SpecialtyCatalogController, SpecialtiesController],
  providers: [SpecialtyCatalogService, SpecialtiesService, TenantSpecialtiesService],
  exports: [SpecialtyCatalogService, SpecialtiesService, TenantSpecialtiesService],
})
export class SpecialtiesModule {}
