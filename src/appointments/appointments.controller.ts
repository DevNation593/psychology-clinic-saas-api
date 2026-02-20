import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  CancelAppointmentDto,
} from './dto/appointment.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('appointments')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT')
  @Post()
  @ApiOperation({
    summary: 'Create appointment with conflict detection',
    description: 'Validates working hours and checks for time slot conflicts',
  })
  @ApiResponse({ status: 201, description: 'Appointment created' })
  @ApiResponse({
    status: 409,
    description: 'Time slot conflict',
    schema: {
      example: {
        statusCode: 409,
        error: 'APPOINTMENT_CONFLICT',
        message: 'This time slot conflicts with existing appointment(s)',
        conflicts: [
          {
            id: 'appointment-id',
            patient: 'Juan Pérez',
            startTime: '2024-03-15T10:00:00Z',
            endTime: '2024-03-15T11:00:00Z',
          },
        ],
      },
    },
  })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() createAppointmentDto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(tenantId, createAppointmentDto);
  }

  @Get()
  @ApiOperation({ summary: 'List appointments with filters' })
  @ApiQuery({ name: 'psychologistId', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date string' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date string' })
  @ApiResponse({ status: 200, description: 'Appointments list' })
  async findAll(
    @Param('tenantId') tenantId: string,
    @Query('psychologistId') psychologistId?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.appointmentsService.findAll(tenantId, {
      psychologistId,
      patientId,
      status,
      from,
      to,
    });
  }

  @Get(':appointmentId')
  @ApiOperation({ summary: 'Get appointment details' })
  @ApiResponse({ status: 200, description: 'Appointment found' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async findOne(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.appointmentsService.findOne(tenantId, appointmentId);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT')
  @Patch(':appointmentId')
  @ApiOperation({ summary: 'Update appointment (checks conflicts if time changed)' })
  @ApiResponse({ status: 200, description: 'Appointment updated' })
  @ApiResponse({ status: 409, description: 'Time slot conflict' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(tenantId, appointmentId, updateAppointmentDto);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Post(':appointmentId/cancel')
  @ApiOperation({ summary: 'Cancel appointment' })
  @ApiResponse({ status: 200, description: 'Appointment cancelled' })
  async cancel(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() cancelDto: CancelAppointmentDto,
    @CurrentUser() user: any,
  ) {
    return this.appointmentsService.cancel(tenantId, appointmentId, user.userId, cancelDto.reason);
  }
}
