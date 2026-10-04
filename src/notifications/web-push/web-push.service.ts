import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { VapidKeys, encryptPushPayload, vapidAuthorization } from './web-push.crypto';

const SEND_TIMEOUT_MS = 10_000;
const TTL_SECONDS = 24 * 60 * 60;

/**
 * The API posts to the endpoint a browser hands it, so only the push services of the
 * browsers are accepted: anything else would let a user point the server at any URL.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export interface WebPushMessage {
  title: string;
  body: string;
  /** Read by the service worker; `url` is opened when the notification is clicked. */
  data?: Record<string, string>;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Web Push (VAPID) to the browsers a user subscribed. Independent of Firebase. */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly vapid: VapidKeys | null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
    const subject = config.get<string>('VAPID_SUBJECT');
    this.vapid = publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
    if (!this.vapid) {
      this.logger.warn('VAPID keys not configured. Web Push is disabled.');
    }
  }

  get isEnabled(): boolean {
    return this.vapid !== null;
  }

  /** The key browsers subscribe with; null while Web Push is not configured. */
  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async subscribe(
    tenantId: string,
    userId: string,
    subscription: BrowserSubscription,
    userAgent?: string,
  ) {
    if (!isPushServiceEndpoint(subscription.endpoint)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PUSH_ENDPOINT_NOT_ALLOWED',
        message: 'El punto de entrega no pertenece a un servicio de notificaciones conocido.',
      });
    }
    const data = {
      tenantId,
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    };
    // The same browser re-subscribing, or another account signing in on it, takes the row over.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: { endpoint: subscription.endpoint, ...data },
      update: data,
    });
    return { message: 'Suscripción registrada' };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { message: 'Suscripción eliminada' };
  }

  /** Sends to every browser of the user. Returns how many accepted the message. */
  async sendToUser(
    tenantId: string,
    userId: string,
    message: WebPushMessage,
  ): Promise<{ attempted: number; delivered: number }> {
    if (!this.vapid) return { attempted: 0, delivered: 0 };

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { tenantId, userId },
    });
    const payload = Buffer.from(JSON.stringify(message));
    const results = await Promise.all(
      subscriptions.map((subscription) => this.sendOne(subscription, payload)),
    );

    return { attempted: subscriptions.length, delivered: results.filter(Boolean).length };
  }

  private async sendOne(
    subscription: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: Buffer,
  ): Promise<boolean> {
    try {
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, this.vapid!),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS),
        },
        body: new Uint8Array(encryptPushPayload(payload, subscription)),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (response.status === 404 || response.status === 410) {
        // The browser unsubscribed or the subscription expired: it will never work again.
        await this.prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
        return false;
      }
      if (!response.ok) {
        this.logger.warn(`Push service answered ${response.status} for a subscription`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Web Push delivery failed: ${(error as Error).message}`);
      return false;
    }
  }
}
