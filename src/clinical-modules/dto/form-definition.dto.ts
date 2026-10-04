import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const SCHEMA_EXAMPLE = {
  sections: [
    {
      key: 'injury',
      title: 'Lesión',
      fields: [
        {
          key: 'injuryType',
          label: 'Tipo de lesión',
          type: 'select',
          required: true,
          options: [
            { value: 'TRAUMATICA', label: 'Traumática' },
            { value: 'DEPORTIVA', label: 'Deportiva' },
            { value: 'LABORAL', label: 'Laboral' },
          ],
        },
      ],
    },
  ],
};

export class CreateFormDefinitionDto {
  @ApiProperty({ example: 'Ficha de lesión' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Clasificación inicial de la lesión del paciente.' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'Evaluación' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({
    example: 'PHYSIOTHERAPY',
    nullable: true,
    description: 'Restricts the form to one enabled specialty. Null: any professional.',
  })
  @IsString()
  @IsOptional()
  specialtyCode?: string | null;

  @ApiProperty({ example: SCHEMA_EXAMPLE, description: 'Sections, fields and optional alerts.' })
  @IsObject()
  schema: Record<string, unknown>;
}

export class UpdateFormDefinitionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  specialtyCode?: string | null;

  @ApiPropertyOptional({
    example: SCHEMA_EXAMPLE,
    description: 'A schema that differs from the current one is stored as a new version.',
  })
  @IsObject()
  @IsOptional()
  schema?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'An inactive form keeps its answers but accepts no new ones.',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
