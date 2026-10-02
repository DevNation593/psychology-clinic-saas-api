import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClinicalActor, CurrentClinicalActor } from '../clinical-access/clinical-actor';
import { ClinicalProfileGuard } from '../clinical-access/clinical-profile.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSpecialtyRecordDto } from './dto/create-specialty-record.dto';
import { SpecialtyRecordsService } from './specialty-records.service';
import { RequireSection } from '../common/decorators/require-section.decorator';

@ApiTags('specialty-records')
@ApiBearerAuth('access-token')
@RequireSection('core.specialties')
@UseGuards(ClinicalProfileGuard)
@Controller('tenants/:tenantId/patients/:patientId/specialty-records')
export class SpecialtyRecordsController {
  constructor(private readonly recordsService: SpecialtyRecordsService) {}

  @Get()
  @Roles('MASTER', 'PROFESIONAL')
  @ApiOperation({
    summary: 'List patient records from specialty modules',
    description: 'Requires an active professional profile. Every record returned is audited.',
  })
  @ApiQuery({ name: 'moduleKey', required: false })
  list(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @CurrentClinicalActor() actor: ClinicalActor,
    @Query('moduleKey') moduleKey?: string,
  ) {
    return this.recordsService.list(tenantId, patientId, actor, moduleKey);
  }

  @Post()
  @Roles('MASTER', 'PROFESIONAL')
  @ApiOperation({ summary: 'Create a specialty clinical record under the own specialty' })
  create(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @CurrentClinicalActor() actor: ClinicalActor,
    @Body() dto: CreateSpecialtyRecordDto,
  ) {
    return this.recordsService.create(tenantId, patientId, actor, dto);
  }
}
