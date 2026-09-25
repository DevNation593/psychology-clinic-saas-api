import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';

import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ProfessionalProfileInputDto } from '../../professional-profiles/dto/professional-profile.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'clinic-tenant-id' })
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @ApiProperty({ example: 'doctor@clinic.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiProperty({ example: 'María' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'González' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: '+52 555 987 6543' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Psicóloga clínica' })
  @IsString()
  @IsOptional()
  professionalTitle?: string;

  @ApiPropertyOptional({ example: 'PROF-12345' })
  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @ApiPropertyOptional({ type: [String], example: ['specialty-id'] })
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  @IsOptional()
  specialtyIds?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  specialtyId?: string;

  @ApiPropertyOptional({ type: ProfessionalProfileInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfessionalProfileInputDto)
  professionalProfile?: ProfessionalProfileInputDto | null;

  @ApiProperty({ enum: UserRole, example: 'ADMIN' })
  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;
}

export class InviteUserDto extends OmitType(CreateUserDto, ['tenantId', 'password'] as const) {}

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['tenantId', 'password'] as const),
) {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

export class ActivateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
