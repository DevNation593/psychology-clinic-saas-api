import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateModuleDto } from './dto/update-module.dto';
import { UpdateTenantSpecialtiesDto } from './dto/update-specialties.dto';
import { SpecialtiesService } from './specialties.service';

@ApiTags('specialties')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId')
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Get('specialties')
  @ApiOperation({ summary: 'List the specialties enabled for a practice' })
  listSpecialties(@Param('tenantId') tenantId: string) {
    return this.specialtiesService.listForTenant(tenantId);
  }

  @Post('specialties')
  @Roles('CLIENTE')
  @ApiOperation({ summary: 'Select specialties for the tenant' })
  setSpecialties(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantSpecialtiesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.specialtiesService.setForTenant(tenantId, dto.specialtyCodes, user.userId);
  }

  @Get('modules')
  @ApiOperation({ summary: 'List the modules enabled for a practice' })
  listModules(@Param('tenantId') tenantId: string) {
    return this.specialtiesService.listModulesForTenant(tenantId);
  }

  @Patch('modules/:moduleKey')
  @Roles('CLIENTE')
  @ApiOperation({ summary: 'Enable or disable a practice module' })
  updateModule(
    @Param('tenantId') tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() updateModuleDto: UpdateModuleDto,
  ) {
    return this.specialtiesService.updateModule(tenantId, moduleKey, updateModuleDto.enabled);
  }
}
