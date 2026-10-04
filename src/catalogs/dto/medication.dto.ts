import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMedicationDto {
  @ApiProperty({ example: 'Ibuprofeno MK' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  commercialName: string;

  @ApiPropertyOptional({ example: 'Ibuprofeno' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  activeIngredient?: string;

  @ApiPropertyOptional({ example: '400 mg' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  concentration?: string;

  @ApiPropertyOptional({ example: 'Caja de 20 tabletas' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  presentation?: string;

  @ApiPropertyOptional({ example: 'Tableta' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  pharmaceuticalForm?: string;
}

export class UpdateMedicationDto extends PartialType(CreateMedicationDto) {
  @ApiPropertyOptional({
    description: 'An inactive medication is no longer offered when prescribing.',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
