import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail, IsDateString } from 'class-validator';

export class CreatePatientDto {
  @ApiProperty({ example: 'Juan' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'juan.perez@email.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+52 555 123 4567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'Masculino', description: 'Género del paciente' })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({ example: 'Calle Principal 123' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'María Pérez (Madre)' })
  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @ApiPropertyOptional({ example: '+52 555 987 6543' })
  @IsString()
  @IsOptional()
  emergencyPhone?: string;

  @ApiPropertyOptional({ example: 'María Pérez', description: 'Nombre del contacto de emergencia' })
  @IsString()
  @IsOptional()
  emergencyContactName?: string;

  @ApiPropertyOptional({ example: '+52 555 111 2222', description: 'Teléfono del contacto de emergencia' })
  @IsString()
  @IsOptional()
  emergencyContactPhone?: string;

  @ApiPropertyOptional({ description: 'ID del psicólogo asignado al paciente' })
  @IsString()
  @IsOptional()
  assignedPsychologistId?: string;

  @ApiPropertyOptional({ example: 'Alergia a penicilina' })
  @IsString()
  @IsOptional()
  allergies?: string;

  @ApiPropertyOptional({ example: 'Sertralina 50mg' })
  @IsString()
  @IsOptional()
  currentMedication?: string;

  @ApiPropertyOptional({ example: 'Notas generales sobre el paciente' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
