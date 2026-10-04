import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClinicalModulesController } from './clinical-modules.controller';
import { ClinicalModulesService } from './clinical-modules.service';
import { FormDefinitionsService } from './form-definitions.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClinicalModulesController],
  providers: [ClinicalModulesService, FormDefinitionsService],
})
export class ClinicalModulesModule {}
