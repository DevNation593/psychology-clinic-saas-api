import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformSummaryService } from './platform-summary.service';

@ApiTags('platform')
@ApiBearerAuth('access-token')
@PlatformRoute()
@Roles('ADMIN')
@Controller('platform')
export class PlatformSummaryController {
  constructor(private readonly summary: PlatformSummaryService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Platform dashboard figures' })
  getSummary() {
    return this.summary.getSummary();
  }
}
