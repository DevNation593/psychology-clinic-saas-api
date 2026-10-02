import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { PlatformTenantsService } from './platform-tenants.service';

@ApiTags('platform')
@ApiBearerAuth('access-token')
@PlatformRoute()
@Roles('ADMIN')
@Controller('platform')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Post('tenants')
  create(@Body() dto: CreatePlatformTenantDto, @CurrentUser() user: AuthUser) {
    return this.tenants.create(dto, user.userId);
  }

  @Get('tenants/:tenantId')
  findOne(@Param('tenantId') tenantId: string) {
    return this.tenants.findOne(tenantId);
  }

  @Get('section-catalog')
  getSectionCatalog() {
    return this.tenants.getSectionCatalog();
  }
}
