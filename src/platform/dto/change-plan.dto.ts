import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ChangePlanDto {
  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiPropertyOptional({ description: 'Overrides the seats of the plan.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  seatsPsychologistsMax?: number;

  @ApiPropertyOptional({ description: 'Overrides the active patient limit of the plan.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxActivePatients?: number;

  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  reason: string;
}
