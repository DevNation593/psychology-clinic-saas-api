import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications.service';
import { PUBLIC_USER_SELECT } from '../../common/utils/public-user-select';

/**
 * Parses a reminder rule such as "24h", "2h" or "30m" into hours before the appointment.
 * Returns null for rules that cannot be understood.
 */
export function parseReminderRule(rule: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(h|m)\s*$/i.exec(rule);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!(amount > 0)) {
    return null;
  }
  return match[2].toLowerCase() === 'm' ? amount / 60 : amount;
}

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

        // Parse tenant's reminder rules ("24h", "2h", "30m"...) into hours
        const tenantRules = tenant.settings.reminderRules
          .map((rule) => ({ rule, hoursBefore: parseReminderRule(rule) }))
          .filter(
            (parsed): parsed is { rule: string; hoursBefore: number } =>
              parsed.hoursBefore !== null,
          );

        // Find appointments needing reminders
        for (const { rule, hoursBefore } of tenantRules) {
          const startTimeFrom = new Date(
            now.getTime() + hoursBefore * 60 * 60 * 1000 - 30 * 60 * 1000,
          );
          const startTimeTo = new Date(
            now.getTime() + hoursBefore * 60 * 60 * 1000 + 30 * 60 * 1000,
          );

          const candidates = await this.prisma.appointment.findMany({
            where: {
              tenantId: tenant.id,
              status: { in: ['SCHEDULED', 'CONFIRMED'] },
              startTime: {
                gte: startTimeFrom < now ? now : startTimeFrom,
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
              psychologist: { select: PUBLIC_USER_SELECT },
            },
          });

          // Rules without a dedicated flag are de-duplicated through the notification log.
          let appointments = candidates;
          if (hoursBefore !== 24 && hoursBefore !== 2 && candidates.length > 0) {
            const alreadySent = await this.prisma.notificationLog.findMany({
              where: {
                tenantId: tenant.id,
                type: 'APPOINTMENT_REMINDER',
                relatedEntityType: 'appointment',
                relatedEntityId: { in: candidates.map((appointment) => appointment.id) },
                data: { path: ['reminderRule'], equals: rule },
              },
              select: { relatedEntityId: true },
            });
            const sentIds = new Set(alreadySent.map((log) => log.relatedEntityId));
            appointments = candidates.filter((appointment) => !sentIds.has(appointment.id));
          }

          for (const appointment of appointments) {
            try {
              // Send reminder
              await this.notificationsService.sendAppointmentReminder(
                tenant.id,
                appointment.psychologistId,
                appointment,
                hoursBefore,
                rule,
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
                `Sent ${rule} reminder for appointment ${appointment.id} to ${appointment.psychologist.email}`,
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
