import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications.service';
import { parseReminderRule, ReminderProcessor } from './reminder.processor';

describe('parseReminderRule', () => {
  it.each([
    ['24h', 24],
    ['2h', 2],
    ['30m', 0.5],
    ['90m', 1.5],
  ])('parses %s as %s hours', (rule, hours) => {
    expect(parseReminderRule(rule)).toBe(hours);
  });

  it.each(['', 'soon', '0h', '-2h', '2d'])('rejects %p', (rule) => {
    expect(parseReminderRule(rule)).toBeNull();
  });
});

describe('ReminderProcessor', () => {
  const prisma = {
    tenant: { findMany: jest.fn() },
    appointment: { findMany: jest.fn(), update: jest.fn() },
    notificationLog: { findMany: jest.fn() },
  };
  const notifications = { sendAppointmentReminder: jest.fn() };
  const processor = new ReminderProcessor(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  const startTime = new Date('2026-10-02T15:00:00.000Z');
  const appointment = (id: string) => ({
    id,
    startTime,
    psychologistId: 'professional-1',
    psychologist: { email: 'pro@example.com' },
  });
  const sentLog = (id: string, reminderRule: string, loggedStart = startTime) => ({
    relatedEntityId: id,
    data: { reminderRule, startTime: loggedStart.toISOString() },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', settings: { reminderEnabled: true, reminderRules: ['30m'] } },
    ]);
  });

  it('sends a minute-based reminder only once per appointment', async () => {
    prisma.appointment.findMany.mockResolvedValue([appointment('a-1'), appointment('a-2')]);
    prisma.notificationLog.findMany.mockResolvedValue([sentLog('a-1', '30m')]);

    await expect(processor.handleReminderCheck({} as any)).resolves.toEqual({ totalSent: 1 });

    expect(notifications.sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(notifications.sendAppointmentReminder).toHaveBeenCalledWith(
      'tenant-1',
      'professional-1',
      expect.objectContaining({ id: 'a-2' }),
      0.5,
      '30m',
    );
  });

  it('reminds again when the appointment was rescheduled after the last reminder', async () => {
    prisma.appointment.findMany.mockResolvedValue([appointment('a-1')]);
    prisma.notificationLog.findMany.mockResolvedValue([
      sentLog('a-1', '30m', new Date('2026-10-02T10:00:00.000Z')),
    ]);

    await expect(processor.handleReminderCheck({} as any)).resolves.toEqual({ totalSent: 1 });
  });

  it('treats equivalent rules as a single reminder', async () => {
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', settings: { reminderEnabled: true, reminderRules: ['60m', '1h'] } },
    ]);
    prisma.appointment.findMany.mockResolvedValue([appointment('a-1')]);
    prisma.notificationLog.findMany.mockResolvedValue([]);

    await expect(processor.handleReminderCheck({} as any)).resolves.toEqual({ totalSent: 1 });
    expect(prisma.appointment.findMany).toHaveBeenCalledTimes(1);
  });

  it('ignores rules it cannot parse', async () => {
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', settings: { reminderEnabled: true, reminderRules: ['whenever'] } },
    ]);

    await expect(processor.handleReminderCheck({} as any)).resolves.toEqual({ totalSent: 0 });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });
});
