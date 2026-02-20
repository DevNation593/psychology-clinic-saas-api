import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('patients')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT')
  @Post()
  @ApiOperation({ summary: 'Create new patient' })
  @ApiResponse({ status: 201, description: 'Patient created' })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() createPatientDto: CreatePatientDto,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.create(tenantId, createPatientDto, user.userId, user.role);
  }

  @Get()
  @ApiOperation({ summary: 'List all patients' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or email' })
  @ApiResponse({ status: 200, description: 'Patients list' })
  async findAll(@Param('tenantId') tenantId: string, @Query('search') search?: string) {
    return this.patientsService.findAll(tenantId, search);
  }

  @Get(':patientId')
  @ApiOperation({ summary: 'Get patient details' })
  @ApiResponse({ status: 200, description: 'Patient found' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findOne(@Param('tenantId') tenantId: string, @Param('patientId') patientId: string) {
    return this.patientsService.findOne(tenantId, patientId);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT')
  @Patch(':patientId')
  @ApiOperation({ summary: 'Update patient' })
  @ApiResponse({ status: 200, description: 'Patient updated' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @Body() updatePatientDto: UpdatePatientDto,
  ) {
    return this.patientsService.update(tenantId, patientId, updatePatientDto);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Delete(':patientId')
  @ApiOperation({ summary: 'Soft delete patient' })
  @ApiResponse({ status: 200, description: 'Patient deleted' })
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('patientId') patientId: string,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.softDelete(tenantId, patientId, user.userId, user.role);
  }
}
