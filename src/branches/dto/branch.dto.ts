import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'Sede Cumbayá' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Av. Interoceánica y Francisco de Orellana' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 'Quito' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '+593 2 123 4567' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'Lunes a viernes de 08:00 a 18:00' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  openingHours?: string;

  @ApiPropertyOptional({ example: ['Consultorio 1', 'Consultorio 2'] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @IsOptional()
  rooms?: string[];
}

export class SetBranchProfessionalsDto {
  @ApiProperty({ example: ['user_cuid'], description: 'An empty list removes every assignment.' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds: string[];
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @ApiPropertyOptional({
    description: 'An inactive branch keeps its history but takes no new appointments.',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'True makes this the main branch; the previous one stops being it.',
  })
  @IsBoolean()
  @IsOptional()
  isMain?: boolean;
}
