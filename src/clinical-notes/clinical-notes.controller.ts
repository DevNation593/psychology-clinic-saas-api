import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ClinicalNotesService } from './clinical-notes.service';
import { CreateClinicalNoteDto, UpdateClinicalNoteDto } from './dto/clinical-note.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/require-feature.decorator';

@ApiTags('clinical-notes')
@ApiBearerAuth('access-token')
@RequireFeature('clinicalNotes')
@Controller('tenants/:tenantId/clinical-notes')
export class ClinicalNotesController {
  constructor(private readonly clinicalNotesService: ClinicalNotesService) {}

  @Roles('PSYCHOLOGIST')
  @Post()
  @ApiOperation({
    summary: 'Create clinical note - Psychologist only',
    description: 'Creates audit log entry automatically',
  })
  @ApiResponse({ status: 201, description: 'Clinical note created' })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() createDto: CreateClinicalNoteDto,
    @CurrentUser() user: any,
  ) {
    return this.clinicalNotesService.create(tenantId, user.userId, createDto);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Get()
  @ApiOperation({ summary: 'List clinical notes with filters' })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiQuery({ name: 'psychologistId', required: false })
  @ApiResponse({ status: 200, description: 'Clinical notes list' })
  async findAll(
    @Param('tenantId') tenantId: string,
    @Query('patientId') patientId?: string,
    @Query('psychologistId') psychologistId?: string,
    @CurrentUser() user?: any,
  ) {
    return this.clinicalNotesService.findAll(
      tenantId,
      { patientId, psychologistId },
      user.userId,
      user.role,
    );
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Get(':noteId')
  @ApiOperation({
    summary: 'Get clinical note - Restricted access',
    description: 'Psychologists can only read their own notes. Creates audit log entry.',
  })
  @ApiResponse({ status: 200, description: 'Clinical note found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async findOne(
    @Param('tenantId') tenantId: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: any,
  ) {
    return this.clinicalNotesService.findOne(tenantId, noteId, user.userId, user.role);
  }

  @Roles('TENANT_ADMIN', 'PSYCHOLOGIST')
  @Patch(':noteId')
  @ApiOperation({
    summary: 'Update clinical note',
    description: 'Psychologists can only edit their own notes. Creates audit log entry.',
  })
  @ApiResponse({ status: 200, description: 'Clinical note updated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('noteId') noteId: string,
    @Body() updateDto: UpdateClinicalNoteDto,
    @CurrentUser() user: any,
  ) {
    return this.clinicalNotesService.update(tenantId, noteId, user.userId, user.role, updateDto);
  }

  @Roles('TENANT_ADMIN')
  @Delete(':noteId')
  @ApiOperation({
    summary: 'Delete clinical note - Admin only',
    description: 'Creates audit log entry.',
  })
  @ApiResponse({ status: 200, description: 'Clinical note deleted' })
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: any,
  ) {
    return this.clinicalNotesService.delete(tenantId, noteId, user.userId, user.role);
  }
}
