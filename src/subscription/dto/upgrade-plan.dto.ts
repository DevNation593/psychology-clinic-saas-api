import { IsEnum } from 'class-validator';
import { PlanType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpgradePlanDto {
  @ApiProperty({
    description: 'New plan type to upgrade to',
    enum: ['BASIC', 'PRO', 'CUSTOM'],
  })
  @IsEnum(PlanType)
  newPlan: PlanType;
}
