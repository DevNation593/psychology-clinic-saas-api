import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications.service';

@Processor('reminders')
export class ReminderProcessor {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  @Process('check-appointments')
  async handleReminderCheck(job: Job) {
    this.logger.log('Starting appointment reminder check...');

    try {
      const now = new Date();
      const reminderRules = [24, 2]; // 24 hours and 2 hours before

      // Find all tenants with reminder settings
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true },
        include: { settings: true },
      });

      let totalSent = 0;

      for (const tenant of tenants) {
        if (!tenant.settings?.reminderEnabled) {
          continue;
        }

        // Parse tenant's reminder rules
        const tenantRules = tenant.settings.reminderRules.map((rule) => {
          const hours = parseInt(rule.replace('h', ''));
          return hours;
        });

        // Find appointments needing reminders
        for (const hoursBefore of tenantRules) {
          const startTimeFrom = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000 - 30 * 60 * 1000);
          const startTimeTo = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000 + 30 * 60 * 1000);

          const appointments = await this.prisma.appointment.findMany({
            where: {
              tenantId: tenant.id,
              status: { in: ['SCHEDULED', 'CONFIRMED'] },
              startTime: {
                gte: startTimeFrom,
                lte: startTimeTo,
              },
              // Check if reminder already sent
              ...(hoursBefore === 24
                ? { reminderSent24h: false }
                : hoursBefore === 2
                ? { reminderSent2h: false }
                : {}),
            },
            include: {
              patient: true,
              psychologist: true,
            },
          });

          for (const appointment of appointments) {
            try {
              // Send reminder
              await this.notificationsService.sendAppointmentReminder(
                tenant.id,
                appointment.psychologistId,
                appointment,
                hoursBefore,
              );

              // Mark as sent
              const updateData: any = { lastReminderSentAt: new Date() };
              if (hoursBefore === 24) {
                updateData.reminderSent24h = true;
              } else if (hoursBefore === 2) {
                updateData.reminderSent2h = true;
              }

              await this.prisma.appointment.update({
                where: { id: appointment.id },
                data: updateData,
              });

              totalSent++;
              this.logger.log(
                `Sent ${hoursBefore}h reminder for appointment ${appointment.id} to ${appointment.psychologist.email}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to send reminder for appointment ${appointment.id}`,
                error.stack,
              );
            }
          }
        }
      }

      this.logger.log(`Reminder check completed. Sent ${totalSent} reminders.`);
      return { totalSent };
    } catch (error) {
      this.logger.error('Error in reminder check', error.stack);
      throw error;
    }
  }
}
