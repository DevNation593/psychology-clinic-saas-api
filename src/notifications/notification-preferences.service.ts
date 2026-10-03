import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationPreferences {
  /** false keeps every notification in the app only: nothing is pushed to devices. */
  pushEnabled: boolean;
  appointmentReminders: boolean;
  taskDueReminders: boolean;
  morningDigest: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  appointmentReminders: true,
  taskDueReminders: true,
  morningDigest: false,
};

const pick = (row: NotificationPreferences): NotificationPreferences => ({
  pushEnabled: row.pushEnabled,
  appointmentReminders: row.appointmentReminders,
  taskDueReminders: row.taskDueReminders,
  morningDigest: row.morningDigest,
});

/** What each user asked to be notified about. The server is the only place where it is decided. */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return row ? pick(row) : { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  /** Preferences of several users at once; users without a row get the defaults. */
  async getMany(userIds: string[]): Promise<Map<string, NotificationPreferences>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds } },
    });
    const stored = new Map(rows.map((row) => [row.userId, pick(row)]));
    return new Map(
      userIds.map((id) => [id, stored.get(id) ?? { ...DEFAULT_NOTIFICATION_PREFERENCES }]),
    );
  }

  async update(
    userId: string,
    changes: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_NOTIFICATION_PREFERENCES, ...changes },
      update: changes,
    });
    return pick(row);
  }
}
