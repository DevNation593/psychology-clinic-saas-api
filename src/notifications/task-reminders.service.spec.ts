import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesService,
} from './notification-preferences.service';
import { NotificationsService } from './notifications.service';
import { TaskRemindersService } from './task-reminders.service';

describe('TaskRemindersService', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const tenant = (overrides = {}) => ({
    settings: { reminderEnabled: true, timezone: 'America/Guayaquil', ...overrides },
  });
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    title: 'Registro de pensamientos',
    dueDate: new Date('2026-10-17T02:00:00Z'),
    patient: { firstName: 'Ana', lastName: 'Paz' },
    assignedTo: { id: 'assignee', isActive: true },
    createdBy: { id: 'creator', isActive: true },
    tenant: tenant(),
    ...overrides,
  });

  let sentKeys: Set<string>;
  let preferenceRows: Record<string, any>[];
  const prisma = {
    task: { findMany: jest.fn(), count: jest.fn() },
    appointment: { count: jest.fn() },
    notificationPreference: {
      findMany: jest.fn(async ({ where }) =>
        where.morningDigest
          ? preferenceRows.filter((row) => row.morningDigest)
          : preferenceRows.filter((row) => where.userId.in.includes(row.userId)),
      ),
    },
  };
  // Behaves like the real notify: the second call with a key is a no-op.
  const notifications = {
    notify: jest.fn(async (input: Record<string, any>) => {
      if (sentKeys.has(input.dedupeKey)) return null;
      sentKeys.add(input.dedupeKey);
      return { id: input.dedupeKey };
    }),
  };
  const service = new TaskRemindersService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
    new NotificationPreferencesService(prisma as unknown as PrismaService),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sentKeys = new Set();
    preferenceRows = [];
    prisma.task.findMany.mockResolvedValue([task()]);
    prisma.task.count.mockResolvedValue(0);
    prisma.appointment.count.mockResolvedValue(0);
  });

  describe('tasks about to fall due', () => {
    it('looks only at open tasks of active tenants due within the next 24 hours', async () => {
      await service.run(now);

      expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        dueDate: { gt: now, lte: new Date('2026-10-17T12:00:00Z') },
        tenant: { isActive: true, subscription: { status: { in: ['ACTIVE', 'TRIALING'] } } },
      });
    });

    it('notifies the assignee once, however many times the job runs', async () => {
      const first = await service.run(now);
      const second = await service.run(new Date('2026-10-16T12:15:00Z'));

      expect([first.taskReminders, second.taskReminders]).toEqual([1, 0]);
      expect(sentKeys.size).toBe(1);
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({
        tenantId: 'tenant-1',
        userId: 'assignee',
        type: 'TASK_DUE_SOON',
        relatedEntityType: 'task',
        relatedEntityId: 'task-1',
        dedupeKey: 'task-due:task-1:assignee:2026-10-17T02:00:00.000Z',
        data: { taskId: 'task-1', patientId: 'patient-1', url: '/patients/patient-1' },
      });
      // 02:00 UTC is 21:00 of the previous day in Guayaquil.
      expect(notifications.notify.mock.calls[0][0].body).toMatch(
        /^"Registro de pensamientos" de Ana Paz vence el viernes, 16 de octubre.*21:00/,
      );
    });

    it('notifies the creator when nobody is assigned', async () => {
      prisma.task.findMany.mockResolvedValue([task({ assignedTo: null })]);

      await service.run(now);

      expect(notifications.notify.mock.calls[0][0].userId).toBe('creator');
    });

    it('announces a rescheduled task again', async () => {
      await service.run(now);
      prisma.task.findMany.mockResolvedValue([task({ dueDate: new Date('2026-10-17T05:00:00Z') })]);

      expect((await service.run(now)).taskReminders).toBe(1);
      expect(sentKeys.size).toBe(2);
    });

    it('sends nothing to a user who turned task reminders off', async () => {
      preferenceRows = [
        { userId: 'assignee', ...DEFAULT_NOTIFICATION_PREFERENCES, taskDueReminders: false },
      ];

      expect((await service.run(now)).taskReminders).toBe(0);
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it.each([
      ['an inactive recipient', { assignedTo: { id: 'assignee', isActive: false } }],
      ['a tenant with reminders disabled', { tenant: tenant({ reminderEnabled: false }) }],
    ])('sends nothing for %s', async (_label, overrides) => {
      prisma.task.findMany.mockResolvedValue([task(overrides)]);

      expect((await service.run(now)).taskReminders).toBe(0);
    });

    it('decides each recipient by their own preference', async () => {
      prisma.task.findMany.mockResolvedValue([
        task(),
        task({ id: 'task-2', assignedTo: { id: 'other', isActive: true } }),
      ]);
      preferenceRows = [
        { userId: 'assignee', ...DEFAULT_NOTIFICATION_PREFERENCES, taskDueReminders: false },
      ];

      await service.run(now);

      expect(notifications.notify.mock.calls.map(([input]) => input.userId)).toEqual(['other']);
    });
  });

  describe('morning digest', () => {
    // 12:00 UTC is 07:00 in Guayaquil.
    const subscriber = (timezone = 'America/Guayaquil', overrides = {}) => ({
      userId: 'user-1',
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      morningDigest: true,
      user: {
        id: 'user-1',
        tenantId: 'tenant-1',
        tenant: { settings: { reminderEnabled: true, timezone, ...overrides } },
      },
    });

    beforeEach(() => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(3);
      prisma.task.count.mockResolvedValue(1);
    });

    it('goes out once in the local morning with the counts of the day', async () => {
      preferenceRows = [subscriber()];

      const first = await service.run(now);
      const second = await service.run(new Date('2026-10-16T12:45:00Z'));

      expect([first.digests, second.digests]).toEqual([1, 0]);
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({
        userId: 'user-1',
        type: 'SYSTEM_ANNOUNCEMENT',
        body: '3 citas y 1 tarea por vencer',
        dedupeKey: 'digest:user-1:16/10/2026',
      });
      // Counts cover the rest of the local day: until 05:00 UTC of the 17th.
      expect(prisma.appointment.count.mock.calls[0][0].where.startTime).toEqual({
        gte: now,
        lt: new Date('2026-10-17T05:00:00Z'),
      });
    });

    it('is not sent to users who did not ask for it', async () => {
      preferenceRows = [{ ...subscriber(), morningDigest: false }];

      expect((await service.run(now)).digests).toBe(0);
    });

    it.each([
      ['outside the morning hour of the tenant', subscriber('Europe/Madrid')],
      ['when the tenant disabled reminders', subscriber(undefined, { reminderEnabled: false })],
    ])('is not sent %s', async (_label, row) => {
      preferenceRows = [row];

      expect((await service.run(now)).digests).toBe(0);
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('is skipped on a day with nothing scheduled', async () => {
      preferenceRows = [subscriber()];
      prisma.appointment.count.mockResolvedValue(0);
      prisma.task.count.mockResolvedValue(0);

      expect((await service.run(now)).digests).toBe(0);
    });
  });
});
