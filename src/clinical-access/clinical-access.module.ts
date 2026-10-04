import { Module } from '@nestjs/common';
import { ClinicalAuditService } from './clinical-audit.service';
import { ClinicalCryptoService } from './clinical-crypto.service';
import { ClinicalProfileGuard } from './clinical-profile.guard';

@Module({
  providers: [ClinicalAuditService, ClinicalCryptoService, ClinicalProfileGuard],
  exports: [ClinicalAuditService, ClinicalCryptoService, ClinicalProfileGuard],
})
export class ClinicalAccessModule {}
