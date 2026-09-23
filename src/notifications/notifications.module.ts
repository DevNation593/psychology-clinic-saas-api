import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ReminderProcessor } from './processors/reminder.processor';

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
  providers: [NotificationsService, ...(isRedisEnabled ? [ReminderProcessor] : [])],
  exports: [NotificationsService],
})
export class NotificationsModule {}
