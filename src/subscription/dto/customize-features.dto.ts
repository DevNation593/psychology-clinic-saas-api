import { IsArray, IsString, ArrayNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const AVAILABLE_MODULES = [
  'clinicalNotes',
  'clinicalNotesEncryption',
  'attachments',
  'tasks',
  'psychologicalTests',
  'webPush',
  'fcmPush',
  'advancedAnalytics',
  'videoConsultation',
  'calendarSync',
  'onlineSchedulingWidget',
  'customReports',
  'apiAccess',
  'whatsAppIntegration',
  'sso',
] as const;

export type ModuleName = (typeof AVAILABLE_MODULES)[number];

export class CustomizeFeaturesDto {
  @ApiProperty({
    description: 'List of module names to enable. Unselected modules will be disabled.',
    example: ['clinicalNotes', 'tasks', 'fcmPush', 'onlineSchedulingWidget'],
    enum: AVAILABLE_MODULES,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(AVAILABLE_MODULES, { each: true })
  modules: ModuleName[];
}
