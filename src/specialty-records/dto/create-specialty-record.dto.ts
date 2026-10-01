import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSpecialtyRecordDto {
  @ApiProperty({ example: 'NUTRITION' })
  @IsString()
  specialtyCode: string;

  @ApiProperty({ example: 'nutrition.assessments' })
  @IsString()
  moduleKey: string;

  @ApiProperty({
    example: { weightKg: 72.5, heightCm: 168, bmi: 25.7, dietaryGoals: 'Reducir grasa corporal' },
  })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Revisar evolución en 30 días.' })
  @IsString()
  @IsOptional()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional({ example: '2026-09-22T10:00:00.000Z' })
  @IsISO8601()
  @IsOptional()
  recordDate?: string;

  @ApiPropertyOptional({ example: 'appointment_cuid' })
  @IsString()
  @IsOptional()
  appointmentId?: string;
}
