import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateNextSessionPlanDto {
  @ApiProperty({ example: 'patient-id' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'Trabajar exposición gradual a situaciones de ansiedad' })
  @IsString()
  @IsOptional()
  objectives?: string;

  @ApiPropertyOptional({ example: 'Terapia de exposición, reestructuración cognitiva' })
  @IsString()
  @IsOptional()
  techniques?: string;

  @ApiPropertyOptional({ example: 'Registro de pensamientos automáticos durante la semana' })
  @IsString()
  @IsOptional()
  homework?: string;

  @ApiPropertyOptional({ example: 'Considerar inclusión de técnicas de mindfulness' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateNextSessionPlanDto extends PartialType(CreateNextSessionPlanDto) {}
