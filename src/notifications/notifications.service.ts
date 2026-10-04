import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationLog, NotificationType, Prisma } from '@prisma/client';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { WebPushService } from './web-push/web-push.service';

export interface NotifyInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** When set, the notification is created at most once per tenant for this key. */
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: admin.app.App;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private preferences: NotificationPreferencesService,
    private webPush: WebPushService,
  ) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const projectId = this.configService.get<string>('FCM_PROJECT_ID');
      const privateKey = this.configService.get<string>('FCM_PRIVATE_KEY');
      const clientEmail = this.configService.get<string>('FCM_CLIENT_EMAIL');

      if (
        !projectId ||
        !privateKey ||
        !clientEmail ||
        projectId.includes('your-') ||
        clientEmail.includes('your-') ||
        !privateKey.includes('BEGIN PRIVATE KEY')
      ) {
        this.logger.warn(
          'Firebase credentials not configured. Mobile push notifications will be disabled.',
        );
        return;
      }

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: privateKey.replace(/\\n/g, '\n'),
          clientEmail,
        }),
      });

      this.logger.log('Firebase initialized successfully');
    } catch (error) {
      this.logger.warn(
        'Failed to initialize Firebase. Mobile push notifications will be disabled.',
      );
    }
  }

  /**
   * Creates the in-app notification and, unless the user turned push off, delivers it to
   * their devices: the mobile app through FCM and every subscribed browser through Web Push.
   * Returns null when `dedupeKey` shows this notification was already created.
   */
  async notify(input: NotifyInput): Promise<NotificationLog | null> {
    let notification: NotificationLog;
    try {
      notification = await this.prisma.notificationLog.create({
        data: { ...input, status: 'SENT', sentAt: new Date() },
      });
    } catch (error) {
      // The unique (tenantId, dedupeKey) index is what makes concurrent runs send only once.
      if (input.dedupeKey && (error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        return null;
      }
      throw error;
    }

    const { pushEnabled } = await this.preferences.get(input.userId);
    if (!pushEnabled) return notification;

    const outcome = await this.deliverPush(input);
    if (outcome.fcmToken || outcome.fcmMessageId || outcome.errorMessage) {
      return this.prisma.notificationLog.update({
        where: { id: notification.id },
        data: outcome,
      });
    }
    return notification;
  }

  /** Push delivery never fails the notification: it stays readable in the app. */
  private async deliverPush(input: NotifyInput) {
    const { tenantId, userId, title, body, data } = input;
    const outcome: { fcmToken?: string; fcmMessageId?: string; errorMessage?: string } = {};

    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { fcmToken: true },
    });

    if (user?.fcmToken && this.firebaseApp) {
      outcome.fcmToken = user.fcmToken;
      try {
        outcome.fcmMessageId = await this.firebaseApp.messaging().send({
          token: user.fcmToken,
          notification: { title, body },
          data: data || {},
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              },
            },
          },
        });
      } catch (fcmError: any) {
        this.logger.error(`FCM send failed for user ${userId}: ${fcmError.message}`);
        outcome.errorMessage = fcmError.message || 'FCM send failed';

        // If token is invalid, clear it from the user
        if (
          fcmError.code === 'messaging/invalid-registration-token' ||
          fcmError.code === 'messaging/registration-token-not-registered'
        ) {
          this.logger.warn(`Clearing invalid FCM token for user ${userId}`);
          await this.prisma.user.update({
            where: { id: userId },
            data: { fcmToken: null },
          });
        }
      }
    }

    try {
      await this.webPush.sendToUser(tenantId, userId, { title, body, data });
    } catch (error) {
      this.logger.error(`Web Push failed for user ${userId}: ${(error as Error).message}`);
    }

    return outcome;
  }

  /**
   * Send push notification via FCM
   */
  async sendPushNotification(
    tenantId: string,
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    type: string = 'SYSTEM_ANNOUNCEMENT',
  ) {
    return this.notify({ tenantId, userId, type: type as NotificationType, title, body, data });
  }

  /**
   * Register or update FCM token for a user
   */
  async registerFcmToken(tenantId: string, userId: string, fcmToken: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });

    this.logger.log(`FCM token registered for user ${userId}`);
    return { message: 'Token FCM registrado exitosamente' };
  }

  /**
   * Remove FCM token for a user (on logout or token refresh)
   */
  async removeFcmToken(tenantId: string, userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: null },
    });

    return { message: 'Token FCM eliminado exitosamente' };
  }

  /**
   * Create in-app notification
   */
  async createInAppNotification(
    tenantId: string,
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: any,
    relatedEntityType?: string,
    relatedEntityId?: string,
  ) {
    return this.prisma.notificationLog.create({
      data: {
        tenantId,
        userId,
        type: type as any,
        title,
        body,
        data,
        relatedEntityType,
        relatedEntityId,
        status: 'SENT',
        sentAt: new Date(),
      },
    });
  }

  /**
   * Send appointment reminder notification
   */
  async sendAppointmentReminder(
    tenantId: string,
    psychologistId: string,
    appointment: any,
    hoursBefore: number,
    reminderRule: string = `${hoursBefore}h`,
  ) {
    const { appointmentReminders } = await this.preferences.get(psychologistId);
    if (!appointmentReminders) {
      this.logger.debug(`User ${psychologistId} turned appointment reminders off. Skipping.`);
      return;
    }

    const title = '🔔 Recordatorio de cita';
    const totalMinutes = Math.round(hoursBefore * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeLabel = [
      hours > 0 ? `${hours} ${hours === 1 ? 'hora' : 'horas'}` : '',
      minutes > 0 ? `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const body = `Cita con ${appointment.patient.firstName} ${appointment.patient.lastName} en ${timeLabel}`;

    await this.notify({
      tenantId,
      userId: psychologistId,
      type: 'APPOINTMENT_REMINDER',
      title,
      body,
      data: {
        type: 'APPOINTMENT_REMINDER',
        reminderRule,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        startTime: appointment.startTime.toISOString(),
        url: '/calendar',
      },
      relatedEntityType: 'appointment',
      relatedEntityId: appointment.id,
    });

    this.logger.log(
      `Sent appointment reminder to psychologist ${psychologistId} for appointment ${appointment.id}`,
    );
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(tenantId: string, userId: string, unreadOnly = false) {
    const where: any = { tenantId, userId };

    if (unreadOnly) {
      where.readAt = null;
    }

    return this.prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(tenantId: string, notificationId: string, userId: string) {
    const notification = await this.prisma.notificationLog.findFirst({
      where: { id: notificationId, tenantId, userId },
    });

    if (!notification) {
      return null;
    }

    return this.prisma.notificationLog.update({
      where: { id: notificationId },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(tenantId: string, userId: string) {
    await this.prisma.notificationLog.updateMany({
      where: {
        tenantId,
        userId,
        readAt: null,
      },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });

    return { message: 'Todas las notificaciones marcadas como leídas' };
  }
}
