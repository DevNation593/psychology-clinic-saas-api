import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NextSessionPlansService } from './next-session-plans.service';
import { CreateNextSessionPlanDto, UpdateNextSessionPlanDto } from './dto/next-session-plan.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('next-session-plans')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/next-session-plans')
export class NextSessionPlansController {
  constructor(private readonly nextSessionPlansService: NextSessionPlansService) {}

  @Roles('PSYCHOLOGIST')
  @Post()
  @ApiOperation({ summary: 'Create next session plan for patient' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @ApiResponse({ status: 409, description: 'Plan already exists for this patient' })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() createDto: CreateNextSessionPlanDto,
    @CurrentUser() user: any,
  ) {
    return this.nextSessionPlansService.create(tenantId, user.userId, createDto);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Get()
  @ApiOperation({ summary: 'List all session plans' })
  @ApiQuery({ name: 'psychologistId', required: false })
  @ApiResponse({ status: 200, description: 'Plans list' })
  async findAll(
    @Param('tenantId') tenantId: string,
    @Query('psychologistId') psychologistId?: string,
  ) {
    return this.nextSessionPlansService.findAll(tenantId, psychologistId);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Get('patient/:patientId')
  @ApiOperation({ summary: 'Get session plan for specific patient' })
  @ApiResponse({ status: 200, description: 'Plan found' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async findByPatient(@Param('tenantId') tenantId: string, @Param('patientId') patientId: string) {
    return this.nextSessionPlansService.findByPatient(tenantId, patientId);
  }

  @Roles('PSYCHOLOGIST')
  @Patch('patient/:patientId')
  @ApiOperation({ summary: 'Update session plan for patient' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Body() updateDto: UpdateNextSessionPlanDto,
    @CurrentUser() user: any,
  ) {
    return this.nextSessionPlansService.update(tenantId, patientId, user.userId, updateDto);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Delete('patient/:patientId')
  @ApiOperation({ summary: 'Delete session plan' })
  @ApiResponse({ status: 200, description: 'Plan deleted' })
  async remove(@Param('tenantId') tenantId: string, @Param('patientId') patientId: string) {
    return this.nextSessionPlansService.delete(tenantId, patientId);
  }
}
