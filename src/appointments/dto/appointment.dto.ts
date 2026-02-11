import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsNumber,
  IsEnum,
  IsBoolean,
} from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty({ example: 'patient-id' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ example: 'psychologist-user-id' })
  @IsString()
  @IsNotEmpty()
  psychologistId: string;

  @ApiPropertyOptional({ example: 'Sesión de terapia cognitivo-conductual' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Trabajo sobre ansiedad' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2024-03-15T10:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({ example: 60 })
  @IsNumber()
  @IsNotEmpty()
  duration: number; // minutes

  @ApiPropertyOptional({ example: 'Consultorio 1' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;

  @ApiPropertyOptional({ example: 'https://zoom.us/j/123456789' })
  @IsString()
  @IsOptional()
  meetingUrl?: string;
}

export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiPropertyOptional({ enum: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] })
  @IsEnum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
  @IsOptional()
  status?: string;
}

export class CancelAppointmentDto {
  @ApiProperty({ example: 'Paciente solicitó cancelación' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
