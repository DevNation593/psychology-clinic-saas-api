import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
  IsBoolean,
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

  @ApiProperty({ enum: ['TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT'], example: 'PSYCHOLOGIST' })
  @IsEnum(['TENANT_ADMIN', 'PSYCHOLOGIST', 'ASSISTANT'])
  @IsNotEmpty()
  role: 'TENANT_ADMIN' | 'PSYCHOLOGIST' | 'ASSISTANT';
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

  @ApiProperty({ enum: ['PSYCHOLOGIST', 'ASSISTANT'], example: 'PSYCHOLOGIST' })
  @IsEnum(['PSYCHOLOGIST', 'ASSISTANT'])
  @IsNotEmpty()
  role: 'PSYCHOLOGIST' | 'ASSISTANT';
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
