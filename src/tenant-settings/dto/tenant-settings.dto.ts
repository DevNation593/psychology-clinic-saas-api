import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
  Max,
  Matches,
  ArrayMinSize,
} from 'class-validator';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({
    example: 'sk_test_xxx',
    description: 'API key de Faktur. Se almacena en el servidor.',
  })
  @IsString()
  @IsOptional()
  fakturApiKey?: string;

  @ApiPropertyOptional({ example: 'https://api.faktur.ec' })
  @IsString()
  @IsOptional()
  fakturApiUrl?: string;

  @ApiPropertyOptional({ example: '/invoices' })
  @IsString()
  @IsOptional()
  fakturInvoicePath?: string;

  @ApiPropertyOptional({ example: 'TEST', enum: ['TEST', 'PRODUCTION'] })
  @IsString()
  @IsOptional()
  fakturEnvironment?: string;

  @ApiPropertyOptional({ example: '001' })
  @IsString()
  @IsOptional()
  fakturEstablishment?: string;

  @ApiPropertyOptional({ example: '001' })
  @IsString()
  @IsOptional()
  fakturEmissionPoint?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  @Min(1)
  fakturNextSequential?: number;

  @ApiPropertyOptional({ example: 'Clínica Integral S.A.' })
  @IsString()
  @IsOptional()
  fakturBusinessName?: string;

  @ApiPropertyOptional({ example: 'Av. Principal 123, Quito' })
  @IsString()
  @IsOptional()
  fakturBusinessAddress?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  fakturSpecialTaxpayer?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  fakturAccountingRequired?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  fakturWithholdingAgent?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  fakturEnabled?: boolean;

  @ApiPropertyOptional({ example: 'Clínica Integral S.A.' })
  @IsString()
  @IsOptional()
  legalName?: string;

  @ApiPropertyOptional({ example: 'RUC', enum: ['RUC', 'CEDULA', 'PASSPORT'] })
  @IsString()
  @IsOptional()
  taxIdentificationType?: string;

  @ApiPropertyOptional({ example: '1790012345001' })
  @IsString()
  @IsOptional()
  taxIdentificationNumber?: string;

  // Working hours
  @ApiPropertyOptional({
    example: '09:00',
    description: 'Start of working hours in HH:mm format',
  })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'workingHoursStart must be in HH:mm format',
  })
  workingHoursStart?: string;

  @ApiPropertyOptional({
    example: '18:00',
    description: 'End of working hours in HH:mm format',
  })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'workingHoursEnd must be in HH:mm format',
  })
  workingHoursEnd?: string;

  @ApiPropertyOptional({
    example: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    description: 'Working days of the week',
  })
  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @IsString({ each: true })
  workingDays?: string[];

  // Appointment settings
  @ApiPropertyOptional({
    example: 60,
    description: 'Default appointment duration in minutes',
  })
  @IsInt()
  @IsOptional()
  @Min(15)
  @Max(240)
  defaultAppointmentDuration?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Allow overlapping appointments for same psychologist',
  })
  @IsBoolean()
  @IsOptional()
  allowDoubleBooking?: boolean;

  // Reminder settings
  @ApiPropertyOptional({
    example: ['24h', '2h'],
    description: 'Reminder rules (e.g., "24h", "2h", "30m")',
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  reminderRules?: string[];

  @ApiPropertyOptional({ example: true, description: 'Enable/disable reminders' })
  @IsBoolean()
  @IsOptional()
  reminderEnabled?: boolean;

  // Locale & timezone
  @ApiPropertyOptional({
    example: 'America/Mexico_City',
    description: 'Timezone for the clinic',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({
    example: 'es-MX',
    description: 'Locale for formatting',
  })
  @IsString()
  @IsOptional()
  locale?: string;
}
