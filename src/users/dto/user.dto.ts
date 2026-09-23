import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
  IsBoolean,
  IsArray,
} from 'class-validator';

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
  @IsString({ each: true })
  @IsOptional()
  specialtyIds?: string[];

  @ApiProperty({ enum: ['CLIENTE', 'PSICOLOGO', 'SOPORTE', 'PACIENTE'], example: 'CLIENTE' })
  @IsEnum(['CLIENTE', 'PSICOLOGO', 'SOPORTE', 'PACIENTE'])
  @IsNotEmpty()
  role: 'CLIENTE' | 'PSICOLOGO' | 'SOPORTE' | 'PACIENTE';
}

export class InviteUserDto {
  @ApiProperty({ example: 'doctor@clinic.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

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
  @IsString({ each: true })
  @IsOptional()
  specialtyIds?: string[];

  @ApiProperty({ enum: ['PSICOLOGO', 'PACIENTE'], example: 'PSICOLOGO' })
  @IsEnum(['PSICOLOGO', 'PACIENTE'])
  @IsNotEmpty()
  role: 'PSICOLOGO' | 'PACIENTE';

}

export class UpdateUserDto extends PartialType(CreateUserDto) {
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
