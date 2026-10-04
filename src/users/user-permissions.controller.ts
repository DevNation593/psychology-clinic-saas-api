import { Body, Controller, ForbiddenException, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserPermissionsService } from './user-permissions.service';

export class ReplaceUserPermissionsDto {
  @ApiProperty({
    example: ['appointments.cancel', 'billing.create'],
    description:
      'Permissions of the role that this user must not have. An empty list restores all.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  revoked: string[];

  @ApiPropertyOptional({
    example: ['billing.view'],
    description:
      'Permissions the role lacks that this user receives. Only the ones the catalog marks as grantable to the role. Omitted: none.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsOptional()
  granted?: string[];
}

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/users/:userId/permissions')
export class UserPermissionsController {
  constructor(private readonly permissionsService: UserPermissionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Permissions of a user',
    description:
      'What the role allows and what was withdrawn from this user. `me` reads the caller; reading another user is for the account holder.',
  })
  describe(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const targetId = userId === 'me' ? user.userId : userId;
    if (targetId !== user.userId && user.role !== 'MASTER') {
      throw new ForbiddenException('Solo el titular puede ver los permisos de otro usuario');
    }
    return this.permissionsService.describe(tenantId, targetId);
  }

  @Put()
  @Roles('MASTER')
  @ApiOperation({
    summary: 'Withdraw permissions from a user, or grant ones their role can receive',
    description:
      'Replaces both lists. `revoked` takes permissions of the role away; `granted` gives permissions the role lacks, among the ones the catalog allows for it. The account holder cannot be restricted.',
  })
  replace(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceUserPermissionsDto,
  ) {
    return this.permissionsService.replace(
      tenantId,
      userId,
      user.userId,
      dto.revoked,
      dto.granted ?? [],
    );
  }
}
