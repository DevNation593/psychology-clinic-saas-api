import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtyCatalogController } from './specialty-catalog.controller';
import { SpecialtyCatalogService } from './specialty-catalog.service';
import { SpecialtiesController } from './specialties.controller';
import { SpecialtiesService } from './specialties.service';

@Module({
  imports: [PrismaModule],
  controllers: [SpecialtyCatalogController, SpecialtiesController],
  providers: [SpecialtyCatalogService, SpecialtiesService],
  exports: [SpecialtyCatalogService, SpecialtiesService],
})
export class SpecialtiesModule {}
