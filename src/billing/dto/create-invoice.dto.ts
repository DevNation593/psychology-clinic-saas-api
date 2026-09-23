import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty({ example: 149.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional({ example: 17.99, default: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  tax?: number;

  @ApiProperty({ example: 'Suscripción Clinic Pro - septiembre 2026' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'subscription-tenant-period-2026-09' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
