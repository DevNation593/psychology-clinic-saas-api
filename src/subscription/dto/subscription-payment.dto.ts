import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPaymentStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmSubscriptionPaymentDto {
  @ApiProperty({
    description:
      'Reference of the transfer, deposit or receipt. Each reference confirms one payment.',
    example: 'TRF-2026-10-000123',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reference: string;

  @ApiPropertyOptional({ example: 'Transferencia verificada en el estado de cuenta' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class RejectSubscriptionPaymentDto {
  @ApiProperty({ example: 'No se encontró la transferencia' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class ListSubscriptionPaymentsQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionPaymentStatus })
  @IsEnum(SubscriptionPaymentStatus)
  @IsOptional()
  status?: SubscriptionPaymentStatus;
}
