import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class UpdateTenantSpecialtiesDto {
  @ApiProperty({ example: ['PSYCHOLOGY', 'NUTRITION'], isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  specialtyCodes: string[];
}
