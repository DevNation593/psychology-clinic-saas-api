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

  @ApiPropertyOptional({
    example: '+52 555 111 2222',
    description: 'Teléfono del contacto de emergencia',
  })
  @IsString()
  @IsOptional()
  emergencyContactPhone?: string;

  @ApiPropertyOptional({
    description:
      'Campo de compatibilidad: un ID no nulo asigna o reactiva al profesional en el equipo tratante; null solo borra este vínculo legado.',
    deprecated: true,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  assignedPsychologistId?: string | null;

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

  // Billing recipient. Format and pairing rules are enforced in the service, where the
  // stored values are known; null or an empty string clears a field.
  @ApiPropertyOptional({ example: 'Luis Pérez', nullable: true })
  @IsString()
  @IsOptional()
  billingName?: string | null;

  @ApiPropertyOptional({ example: 'CEDULA', enum: ['CEDULA', 'RUC', 'PASSPORT'], nullable: true })
  @IsString()
  @IsOptional()
  billingTaxIdType?: string | null;

  @ApiPropertyOptional({ example: '1712345678', nullable: true })
  @IsString()
  @IsOptional()
  billingTaxId?: string | null;

  @ApiPropertyOptional({ example: 'luis.perez@email.com', nullable: true })
  @IsString()
  @IsOptional()
  billingEmail?: string | null;

  @ApiPropertyOptional({ example: 'Av. Amazonas 100', nullable: true })
  @IsString()
  @IsOptional()
  billingAddress?: string | null;
}

export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
