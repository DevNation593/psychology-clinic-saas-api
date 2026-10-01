import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SpecialtyCatalogService } from './specialty-catalog.service';

@ApiTags('specialties')
@Controller('specialties')
export class SpecialtyCatalogController {
  constructor(private readonly catalog: SpecialtyCatalogService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List active specialties' })
  list() {
    return this.catalog.listActive();
  }
}
