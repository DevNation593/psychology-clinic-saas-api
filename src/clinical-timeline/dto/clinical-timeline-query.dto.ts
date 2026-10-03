import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export const TIMELINE_ENTRY_TYPES = ['APPOINTMENT', 'CLINICAL_NOTE', 'SPECIALTY_RECORD'] as const;
export type TimelineEntryType = (typeof TIMELINE_ENTRY_TYPES)[number];

export class ClinicalTimelineQueryDto {
  @ApiPropertyOptional({ enum: TIMELINE_ENTRY_TYPES })
  @IsIn(TIMELINE_ENTRY_TYPES)
  @IsOptional()
  type?: TimelineEntryType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  specialtyId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  professionalId?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsISO8601()
  @IsOptional()
  to?: string;
}
