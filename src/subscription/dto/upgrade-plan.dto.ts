import { IsEnum } from 'class-validator';
import { PlanType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpgradePlanDto {
  @ApiProperty({
    description: 'New plan type to upgrade to',
    enum: ['PERSONAL_BASIC', 'PERSONAL_PRO', 'CLINIC_BASIC', 'CLINIC_PRO', 'CLINIC_ENTERPRISE'],
  })
  @IsEnum(PlanType)
  newPlan: PlanType;
}
