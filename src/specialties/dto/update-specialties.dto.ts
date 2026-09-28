import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';

export class UpdateTenantSpecialtiesDto {
  @ApiProperty({ example: ['PSYCHOLOGY', 'NUTRITION'], isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((code) => (typeof code === 'string' ? code.trim() : code))
      : value,
  )
  specialtyCodes: string[];
}
