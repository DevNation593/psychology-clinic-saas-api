import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSpecialtyRecordDto } from './dto/create-specialty-record.dto';
import { SpecialtyRecordsService } from './specialty-records.service';

@ApiTags('specialty-records')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/patients/:patientId/specialty-records')
export class SpecialtyRecordsController {
  constructor(private readonly recordsService: SpecialtyRecordsService) {}

  @Get()
  @ApiOperation({ summary: 'List patient records from specialty modules' })
  @ApiQuery({ name: 'moduleKey', required: false })
  list(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Query('moduleKey') moduleKey?: string,
  ) {
    return this.recordsService.list(tenantId, patientId, moduleKey);
  }

  @Post()
  @Roles('CLIENTE', 'PSICOLOGO')
  @ApiOperation({ summary: 'Create a specialty clinical record' })
  create(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSpecialtyRecordDto,
  ) {
    return this.recordsService.create(tenantId, patientId, user.userId, dto);
  }
}
