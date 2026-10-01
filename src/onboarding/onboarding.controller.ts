import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreateClinicOnboardingDto } from './dto/create-clinic-onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('tenants')
  create(@Body() dto: CreateClinicOnboardingDto) {
    return this.onboarding.create(dto);
  }
}
