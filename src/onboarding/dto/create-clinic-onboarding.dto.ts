import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trimCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

@ValidatorConstraint({ name: 'clinicalFieldsMatchCare', async: false })
class ClinicalFieldsMatchCare implements ValidatorConstraintInterface {
  validate(_: boolean, args: ValidationArguments): boolean {
    const dto = args.object as CreateClinicOnboardingDto;
    return (
      dto.adminProvidesCare === true ||
      [
        dto.adminSpecialtyCode,
        dto.adminProfessionalTitle,
        dto.adminLicenseNumber,
        dto.adminBio,
      ].every((value) => value === undefined)
    );
  }

  defaultMessage(): string {
    return 'Los datos clínicos requieren que el administrador atienda pacientes.';
  }
}

export class CreateClinicOnboardingDto {
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  clinicName: string;

  @ApiProperty()
  @Transform(trimEmail)
  @IsEmail()
  contactEmail: string;

  @ApiPropertyOptional()
  @Transform(trimText)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional()
  @Transform(trimText)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  address?: string;

  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  timezone: string;

  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  locale: string;

  @ApiProperty({ type: [String] })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((code) => trimCode({ value: code })) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  specialtyCodes: string[];

  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  adminFirstName: string;

  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  adminLastName: string;

  @ApiProperty()
  @Transform(trimEmail)
  @IsEmail()
  adminEmail: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  adminPassword: string;

  @ApiProperty()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  @Validate(ClinicalFieldsMatchCare)
  adminProvidesCare: boolean;

  @ApiPropertyOptional()
  @Transform(trimCode)
  @ValidateIf((dto: CreateClinicOnboardingDto) => dto.adminProvidesCare === true)
  @IsString()
  @IsNotEmpty()
  adminSpecialtyCode?: string;

  @ApiPropertyOptional()
  @Transform(trimText)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  adminProfessionalTitle?: string;

  @ApiPropertyOptional()
  @Transform(trimText)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  adminLicenseNumber?: string;

  @ApiPropertyOptional()
  @Transform(trimText)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  adminBio?: string;
}
