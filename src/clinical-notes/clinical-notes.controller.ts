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

  @Roles('PROFESIONAL')
  @Post()
  @ApiOperation({
    summary: 'Create clinical note - Professional only',
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

  @Roles('MASTER', 'PROFESIONAL')
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

  @Roles('MASTER', 'PROFESIONAL')
  @Get(':noteId')
  @ApiOperation({
    summary: 'Get clinical note - Restricted access',
    description: 'Readable by admins and professionals of the tenant. Creates audit log entry.',
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

  @Roles('PROFESIONAL')
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

  @Roles('MASTER', 'PROFESIONAL')
  @Delete(':noteId')
  @ApiOperation({
    summary: 'Delete clinical note - Master or author',
    description:
      'Admins can delete any note; professionals only their own. Creates audit log entry.',
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
