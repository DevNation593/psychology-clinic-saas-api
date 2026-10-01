import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// Formats are checked by the customer resolver, not here, so every problem with the
// recipient is reported together as INVOICE_CUSTOMER_INCOMPLETE.
export class InvoiceCustomerDto {
  @ApiPropertyOptional({ example: 'Luis Pérez' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'CEDULA', enum: ['CEDULA', 'RUC', 'PASSPORT'] })
  @IsString()
  @IsOptional()
  taxIdType?: string;

  @ApiPropertyOptional({ example: '1712345678' })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({ example: 'luis.perez@email.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'Av. Amazonas 100' })
  @IsString()
  @IsOptional()
  address?: string;
}

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Paciente al que corresponde la factura' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({
    description: 'Datos del receptor para esta factura; lo omitido sale de la ficha del paciente',
  })
  @ValidateNested()
  @Type(() => InvoiceCustomerDto)
  @IsOptional()
  customer?: InvoiceCustomerDto;

  @ApiPropertyOptional({
    default: false,
    description: 'Guarda los datos del receptor en la ficha del paciente',
  })
  @IsBoolean()
  @IsOptional()
  saveCustomerToPatient?: boolean;

  @ApiProperty({ example: 149.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional({ example: 17.99, default: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  tax?: number;

  @ApiProperty({ example: 'Consulta de nutrición' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'subscription-tenant-period-2026-09' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
