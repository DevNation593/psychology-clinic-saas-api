import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';

export class SelfProfessionalProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  professionalTitle?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bio?: string;
}

export class UpdateSelfProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ type: SelfProfessionalProfileDto })
  @ValidateNested()
  @Type(() => SelfProfessionalProfileDto)
  @IsOptional()
  professionalProfile?: SelfProfessionalProfileDto;
}
