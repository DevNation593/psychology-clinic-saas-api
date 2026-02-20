import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: admin.app.App;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
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
          'Firebase credentials not configured. Push notifications will be disabled.',
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
      this.logger.warn('Failed to initialize Firebase. Push notifications will be disabled.');
    }
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
    try {
      // Get user's FCM token
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { fcmToken: true },
      });

      const notification = await this.prisma.notificationLog.create({
        data: {
          tenantId,
          userId,
          type: type as any,
          title,
          body,
          data,
          fcmToken: user?.fcmToken || null,
          status: 'PENDING',
        },
      });

      if (!this.firebaseApp) {
        this.logger.warn('Firebase not initialized. Skipping push notification.');
        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: 'Firebase not configured',
          },
        });
        return notification;
      }

      if (!user?.fcmToken) {
        this.logger.debug(`User ${userId} has no FCM token registered. In-app only.`);
        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            errorMessage: 'No FCM token - in-app only',
          },
        });
        return notification;
      }

      // Send real push notification via FCM
      try {
        const messageResult = await this.firebaseApp.messaging().send({
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
          webpush: {
            notification: {
              icon: '/icons/notification-icon.png',
              badge: '/icons/badge-icon.png',
            },
          },
        });

        this.logger.log(`FCM message sent successfully: ${messageResult}`);

        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            fcmMessageId: messageResult,
          },
        });
      } catch (fcmError: any) {
        this.logger.error(`FCM send failed for user ${userId}: ${fcmError.message}`);

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

        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: fcmError.message || 'FCM send failed',
          },
        });
      }

      return notification;
    } catch (error) {
      this.logger.error('Failed to send push notification', error.stack);
      throw error;
    }
  }

  /**
   * Register or update FCM token for a user
   */
  async registerFcmToken(tenantId: string, userId: string, fcmToken: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });

    this.logger.log(`FCM token registered for user ${userId}`);
    return { message: 'FCM token registered successfully' };
  }

  /**
   * Remove FCM token for a user (on logout or token refresh)
   */
  async removeFcmToken(tenantId: string, userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: null },
    });

    return { message: 'FCM token removed successfully' };
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
  ) {
    const title = '🔔 Recordatorio de cita';
    const body = `Cita con ${appointment.patient.firstName} ${appointment.patient.lastName} en ${hoursBefore} horas`;

    const data = {
      type: 'APPOINTMENT_REMINDER',
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      startTime: appointment.startTime.toISOString(),
    };

    // Create in-app notification
    await this.createInAppNotification(
      tenantId,
      psychologistId,
      'APPOINTMENT_REMINDER',
      title,
      body,
      data,
      'appointment',
      appointment.id,
    );

    // Optionally send push notification
    await this.sendPushNotification(
      tenantId,
      psychologistId,
      title,
      body,
      data,
      'APPOINTMENT_REMINDER',
    );

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

    return { message: 'All notifications marked as read' };
  }
}
