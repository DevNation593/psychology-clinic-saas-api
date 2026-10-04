import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { TEMPLATE_MODULE_KEYS } from '../template-catalog';

const MODULE_KEYS = [...TEMPLATE_MODULE_KEYS];

export class CreateDocumentTemplateDto {
  @ApiProperty({ enum: MODULE_KEYS, example: 'general.certificates' })
  @IsIn(MODULE_KEYS)
  moduleKey: string;

  @ApiProperty({ example: 'Reposo médico' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    example: 'Consentimiento para tratamiento de conducto',
    nullable: true,
    description: 'Title of the document, for the modules that have one (consents).',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string | null;

  @ApiProperty({
    example:
      'Certifico que {{paciente}}, con identificación {{identificacion}}, fue atendido el {{fecha}}.',
    description:
      'Variables: {{paciente}}, {{identificacion}}, {{edad}}, {{fecha}}, {{profesional}}, {{consultorio}}.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body: string;
}

export class UpdateDocumentTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(10000)
  body?: string;

  @ApiPropertyOptional({ description: 'An inactive template is no longer offered when writing.' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
