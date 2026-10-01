import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateModuleDto } from './dto/update-module.dto';
import { UpdateTenantSpecialtiesDto } from './dto/update-specialties.dto';
import { SpecialtiesService } from './specialties.service';
import { TenantSpecialtiesService } from './tenant-specialties.service';

@ApiTags('specialties')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId')
export class SpecialtiesController {
  constructor(
    private readonly specialtiesService: SpecialtiesService,
    private readonly tenantSpecialtiesService: TenantSpecialtiesService,
  ) {}

  @Get('specialties')
  @ApiOperation({ summary: 'List the specialties enabled for a practice' })
  listSpecialties(@Param('tenantId') tenantId: string) {
    return this.specialtiesService.listForTenant(tenantId);
  }

  @Put('specialties')
  @Roles('MASTER')
  @ApiOperation({ summary: 'Select specialties for the tenant' })
  setSpecialties(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantSpecialtiesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.tenantSpecialtiesService.replace(tenantId, dto.specialtyCodes, user.userId);
  }

  @Post('specialties')
  @HttpCode(200)
  @Roles('MASTER')
  @ApiOperation({ summary: 'Legacy specialty selection route' })
  setSpecialtiesLegacy(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantSpecialtiesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.setSpecialties(tenantId, dto, user);
  }

  @Get('modules')
  @ApiOperation({ summary: 'List the modules enabled for a practice' })
  listModules(@Param('tenantId') tenantId: string) {
    return this.specialtiesService.listModulesForTenant(tenantId);
  }

  @Patch('modules/:moduleKey')
  @Roles('MASTER')
  @ApiOperation({ summary: 'Enable or disable a practice module' })
  updateModule(
    @Param('tenantId') tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() updateModuleDto: UpdateModuleDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.tenantSpecialtiesService.updateModule(
      tenantId,
      moduleKey,
      updateModuleDto.enabled,
      user.userId,
    );
  }
}
