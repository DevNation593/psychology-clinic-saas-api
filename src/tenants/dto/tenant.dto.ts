import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty, IsOptional, MinLength, IsBoolean } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({ example: 'Mi Clínica de Psicología' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'mi-clinica' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: 'contacto@miclinica.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+52 555 123 4567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Av. Principal 123, Ciudad' })
  @IsString()
  @IsOptional()
  address?: string;

  // Admin user data
  @ApiProperty({ example: 'Juan' })
  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @IsNotEmpty()
  adminLastName: string;

  @ApiProperty({ example: 'admin@miclinica.com' })
  @IsEmail()
  @IsNotEmpty()
  adminEmail: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  adminPassword: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  logoUrl?: string;
}

export class CompleteOnboardingDto {
  @ApiProperty()
  @IsBoolean()
  completed: boolean;
}
