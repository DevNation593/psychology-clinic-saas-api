import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProfessionalProfileInputDto {
  @IsString()
  @IsNotEmpty()
  specialtyId: string;

  @IsString()
  @IsOptional()
  professionalTitle?: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
