import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const PATIENT_FILE_CATEGORIES = [
  'EXAMEN',
  'IMAGEN',
  'INFORME',
  'CONSENTIMIENTO',
  'RECETA',
  'OTRO',
] as const;
export type PatientFileCategory = (typeof PATIENT_FILE_CATEGORIES)[number];

/** The text fields that travel with the file in the multipart request. */
export class UploadPatientFileDto {
  @ApiProperty({ enum: PATIENT_FILE_CATEGORIES, example: 'EXAMEN' })
  @IsIn(PATIENT_FILE_CATEGORIES)
  category: PatientFileCategory;

  @ApiPropertyOptional({ example: 'Hemograma del 2 de octubre.' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'encounter_cuid',
    description: 'An open encounter of the caller with this patient.',
  })
  @IsString()
  @IsOptional()
  encounterId?: string;
}

export class DeletePatientFileDto {
  @ApiProperty({ example: 'Archivo subido al paciente equivocado.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
