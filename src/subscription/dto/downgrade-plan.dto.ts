import { IsEnum } from 'class-validator';
import { PlanType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class DowngradePlanDto {
  @ApiProperty({
    description: 'New plan type to downgrade to',
    enum: ['TRIAL', 'BASIC', 'PRO'],
  })
  @IsEnum(PlanType)
  newPlan: PlanType;
}
