import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { getZonedDateParts } from '../common/utils/timezone';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

const HOUR_MS = 60 * 60 * 1000;

export const TASK_REMINDER_RULES = {
  /** A task is announced once when it falls due within this many hours. */
  dueNoticeHours: 24,
  /** Local hour of the tenant at which the morning digest goes out. */
  digestHour: 7,
} as const;

const OPEN_TASK = { in: ['PENDING', 'IN_PROGRESS'] as ('PENDING' | 'IN_PROGRESS')[] };
const ACTIVE_SUBSCRIPTION = { in: ['ACTIVE', 'TRIALING'] as ('ACTIVE' | 'TRIALING')[] };

const formatInZone = (date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat('es', { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('es', options).format(date);
  }
};

/**
 * Task notifications: a reminder when a task is about to fall due and an optional morning
 * digest. Runs on a plain cron (no Redis). Each notification carries a dedupe key backed by
 * a unique index, so running often, or on several instances, still notifies only once.
 */
@Injectable()
export class TaskRemindersService {
  private readonly logger = new Logger(TaskRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Cron('*/15 * * * *')
  async handleCron() {
    try {
      const report = await this.run();
      if (report.taskReminders > 0 || report.digests > 0) {
        this.logger.log(`Task notifications: ${JSON.stringify(report)}`);
      }
    } catch (error) {
      this.logger.error('Task notification run failed', (error as Error).stack);
    }
  }

  async run(now: Date = new Date()) {
    return {
      taskReminders: await this.sendDueSoonReminders(now),
      digests: await this.sendMorningDigests(now),
    };
  }

  /** The person responsible for a task: whoever it is assigned to, otherwise its creator. */
  private async sendDueSoonReminders(now: Date): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: OPEN_TASK,
        dueDate: {
          gt: now,
          lte: new Date(now.getTime() + TASK_REMINDER_RULES.dueNoticeHours * HOUR_MS),
        },
        tenant: { isActive: true, subscription: { status: ACTIVE_SUBSCRIPTION } },
      },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { id: true, isActive: true } },
        createdBy: { select: { id: true, isActive: true } },
        tenant: { select: { settings: { select: { reminderEnabled: true, timezone: true } } } },
      },
    });

    const due = tasks
      .map((task) => ({ task, recipient: task.assignedTo ?? task.createdBy }))
      .filter(
        ({ task, recipient }) =>
          recipient.isActive && task.tenant.settings?.reminderEnabled !== false,
      );
    const preferences = await this.preferences.getMany([
      ...new Set(due.map(({ recipient }) => recipient.id)),
    ]);

    let sent = 0;
    for (const { task, recipient } of due) {
      if (!preferences.get(recipient.id)?.taskDueReminders) continue;

      const dueDate = task.dueDate!;
      const when = formatInZone(dueDate, task.tenant.settings?.timezone ?? 'UTC', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
      const created = await this.notifications.notify({
        tenantId: task.tenantId,
        userId: recipient.id,
        type: 'TASK_DUE_SOON',
        title: '⏰ Actividad próxima a vencer',
        body: `"${task.title}" de ${task.patient.firstName} ${task.patient.lastName} vence el ${when}`,
        data: {
          type: 'TASK_DUE_SOON',
          taskId: task.id,
          patientId: task.patientId,
          dueDate: dueDate.toISOString(),
          url: `/patients/${task.patientId}`,
        },
        relatedEntityType: 'task',
        relatedEntityId: task.id,
        // The due date is part of the key: a task that is rescheduled is announced again.
        dedupeKey: `task-due:${task.id}:${recipient.id}:${dueDate.toISOString()}`,
      });
      if (created) sent += 1;
    }
    return sent;
  }

  /** Once a day, at the tenant's local morning, to the users who asked for it. */
  private async sendMorningDigests(now: Date): Promise<number> {
    const subscribers = await this.prisma.notificationPreference.findMany({
      where: {
        morningDigest: true,
        user: {
          isActive: true,
          tenant: { isActive: true, subscription: { status: ACTIVE_SUBSCRIPTION } },
        },
      },
      select: {
        user: {
          select: {
            id: true,
            tenantId: true,
            tenant: { select: { settings: { select: { reminderEnabled: true, timezone: true } } } },
          },
        },
      },
    });

    let sent = 0;
    for (const { user } of subscribers) {
      const settings = user.tenant.settings;
      if (settings?.reminderEnabled === false) continue;

      const timeZone = settings?.timezone ?? 'UTC';
      const { minutesOfDay } = getZonedDateParts(now, timeZone);
      if (Math.floor(minutesOfDay / 60) !== TASK_REMINDER_RULES.digestHour) continue;

      const endOfDay = new Date(now.getTime() + (24 * 60 - minutesOfDay) * 60 * 1000);
      const today = { gte: now, lt: endOfDay };
      const [appointments, tasks] = await Promise.all([
        this.prisma.appointment.count({
          where: {
            tenantId: user.tenantId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startTime: today,
            OR: [{ professionalId: user.id }, { professionalId: null, psychologistId: user.id }],
          },
        }),
        this.prisma.task.count({
          where: {
            tenantId: user.tenantId,
            status: OPEN_TASK,
            dueDate: today,
            OR: [{ assignedToId: user.id }, { assignedToId: null, createdById: user.id }],
          },
        }),
      ]);
      if (appointments === 0 && tasks === 0) continue;

      const localDate = formatInZone(now, timeZone, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const created = await this.notifications.notify({
        tenantId: user.tenantId,
        userId: user.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: '☀️ Tu día de hoy',
        body: [
          `${appointments} ${appointments === 1 ? 'cita' : 'citas'}`,
          `${tasks} ${tasks === 1 ? 'actividad por vencer' : 'actividades por vencer'}`,
        ].join(' y '),
        data: { type: 'MORNING_DIGEST', url: '/dashboard' },
        dedupeKey: `digest:${user.id}:${localDate}`,
      });
      if (created) sent += 1;
    }
    return sent;
  }
}
