import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateClinicalNoteDto {
  @ApiProperty({ example: 'patient-id' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'appointment-id' })
  @IsString()
  @IsOptional()
  appointmentId?: string;

  @ApiProperty({ example: 'Paciente refiere mejoría en síntomas de ansiedad...' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ example: 'Trastorno de ansiedad generalizada (F41.1)' })
  @IsString()
  @IsOptional()
  diagnosis?: string;

  @ApiPropertyOptional({ example: 'Continuar con técnicas de relajación y reestructuración cognitiva' })
  @IsString()
  @IsOptional()
  treatment?: string;

  @ApiPropertyOptional({ example: 'Se recomienda seguimiento en 2 semanas' })
  @IsString()
  @IsOptional()
  observations?: string;

  @ApiPropertyOptional({ example: 60 })
  @IsNumber()
  @IsOptional()
  sessionDuration?: number;

  @ApiPropertyOptional({ example: '2024-03-15T10:00:00Z' })
  @IsDateString()
  @IsOptional()
  sessionDate?: string;
}

export class UpdateClinicalNoteDto extends PartialType(CreateClinicalNoteDto) {}
