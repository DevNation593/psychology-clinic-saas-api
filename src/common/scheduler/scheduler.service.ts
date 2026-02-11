import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue('reminders') private remindersQueue: Queue,
  ) {}

  // Run every 15 minutes
  @Cron('*/15 * * * *')
  async handleReminderCheck() {
    this.logger.log('Scheduling appointment reminder check...');

    try {
      await this.remindersQueue.add('check-appointments', {}, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      });

      this.logger.log('Reminder check job scheduled successfully');
    } catch (error) {
      this.logger.error('Failed to schedule reminder check', error.stack);
    }
  }
}
