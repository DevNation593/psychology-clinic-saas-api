import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateModuleDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
