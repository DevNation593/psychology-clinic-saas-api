import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ReminderProcessor } from './processors/reminder.processor';
import { NotificationPreferencesService } from './notification-preferences.service';
import { TaskRemindersService } from './task-reminders.service';
import { WebPushService } from './web-push/web-push.service';

const isRedisEnabled = Boolean(process.env.REDIS_URL);

@Module({
  imports: [
    ...(isRedisEnabled
      ? [
          BullModule.registerQueue({
            name: 'reminders',
          }),
        ]
      : []),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    WebPushService,
    TaskRemindersService,
    ...(isRedisEnabled ? [ReminderProcessor] : []),
  ],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
