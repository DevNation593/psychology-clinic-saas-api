import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppointmentsController } from './appointments/appointments.controller';
import { AppointmentsModule } from './appointments/appointments.module';
import { BranchesController } from './branches/branches.controller';
import { BranchesModule } from './branches/branches.module';
import { CatalogsController } from './catalogs/catalogs.controller';
import { CatalogsModule } from './catalogs/catalogs.module';
import { ClinicalModulesController } from './clinical-modules/clinical-modules.controller';
import { ClinicalModulesModule } from './clinical-modules/clinical-modules.module';
import { PermissionGuard } from './common/guards/permission.guard';
import { PermissionChecker } from './common/permissions/permission-checker.service';
import { PermissionsModule } from './common/permissions/permissions.module';
import { EncountersController } from './encounters/encounters.controller';
import { EncountersModule } from './encounters/encounters.module';
import { PatientFilesController } from './patient-files/patient-files.controller';
import { PatientFilesModule } from './patient-files/patient-files.module';
import { ReportsModule } from './reports/reports.module';
import { RecordDocumentsModule } from './record-documents/record-documents.module';
import { DocumentTemplatesModule } from './document-templates/document-templates.module';
import { DocumentVerificationModule } from './document-verification/document-verification.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { SpecialtyRecordsController } from './specialty-records/specialty-records.controller';
import { SpecialtyRecordsModule } from './specialty-records/specialty-records.module';

/**
 * The unit specs build services by hand, so a missing provider would only show when the API
 * starts. This compiles the modules that have no external connection to resolve.
 */
describe('module wiring', () => {
  it('resolves the clinical, branch, catalog and permission modules without a database', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        PermissionsModule,
        AppointmentsModule,
        BranchesModule,
        CatalogsModule,
        ClinicalModulesModule,
        EncountersModule,
        PatientFilesModule,
        ReportsModule,
        RecordDocumentsModule,
        DocumentTemplatesModule,
        DocumentVerificationModule,
        SpecialtyRecordsModule,
      ],
      providers: [PermissionGuard, Reflector],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    for (const controller of [
      AppointmentsController,
      BranchesController,
      CatalogsController,
      ClinicalModulesController,
      EncountersController,
      PatientFilesController,
      SpecialtyRecordsController,
    ]) {
      expect(moduleRef.get(controller, { strict: false })).toBeInstanceOf(controller);
    }
    expect(moduleRef.get(PermissionChecker, { strict: false })).toBeInstanceOf(PermissionChecker);
    expect(moduleRef.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
  });
});
