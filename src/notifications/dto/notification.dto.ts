import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RegisterFcmTokenDto {
  @ApiProperty({ example: 'fcm-token-from-firebase-sdk', description: 'FCM device token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'false keeps notifications in the app only' })
  @IsBoolean()
  @IsOptional()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  appointmentReminders?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  taskDueReminders?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  morningDigest?: boolean;
}

class PushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  auth: string;
}

/** The object returned by `PushSubscription.toJSON()` in the browser. */
export class WebPushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/...' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint: string;

  @ApiPropertyOptional({ description: 'Sent by browsers; not used' })
  @IsOptional()
  expirationTime?: number | null;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

export class RemoveWebPushSubscriptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  endpoint: string;
}
