import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('audit-log')
@ApiBearerAuth('access-token')
@Roles('MASTER')
@Controller('tenants/:tenantId/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'List audit logs - Master only' })
  @ApiQuery({ name: 'entity', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiResponse({ status: 200, description: 'Audit logs list' })
  async findAll(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLogService.findAll(tenantId, user.userId, {
      entity,
      entityId,
      userId,
      action,
      from,
      to,
    });
  }

  @Get(':entity/:entityId')
  @ApiOperation({ summary: 'Get audit logs for specific entity - Master only' })
  @ApiResponse({ status: 200, description: 'Entity audit history' })
  async findByEntity(
    @Param('tenantId') tenantId: string,
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.auditLogService.findByEntity(tenantId, user.userId, entity, entityId);
  }
}
