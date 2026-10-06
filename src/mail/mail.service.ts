import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailContent, invitationMail, passwordResetMail } from './mail.templates';

const SEND_TIMEOUT_MS = 10_000;

/**
 * Transactional e-mail through an HTTP mail API. The request body is
 * `{ from, to, subject, html, text }` with a Bearer key, the shape that Resend and most
 * providers accept, so switching provider is a matter of configuration:
 *
 *   EMAIL_API_URL   endpoint that sends one message
 *   EMAIL_API_KEY   Bearer token
 *   EMAIL_FROM      sender, e.g. "HCX Care <no-reply@example.com>"
 *
 * Sending never throws: callers must not fail, or reveal that an address exists, because a
 * message could not be delivered. The result says whether the provider accepted it.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {
    if (this.isProduction && !this.isConfigured) {
      this.logger.error(
        'EMAIL_API_URL and EMAIL_FROM are not set: password reset and invitation e-mails will not be delivered',
      );
    }
  }

  get isConfigured(): boolean {
    return !!this.config.get<string>('EMAIL_API_URL') && !!this.config.get<string>('EMAIL_FROM');
  }

  /** Base URL of the web app, used to build the links placed in messages. */
  get webUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:4200').replace(/\/+$/, '');
  }

  sendPasswordReset(to: string, input: { firstName: string; token: string; expiresIn: string }) {
    const resetUrl = `${this.webUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
    return this.send(to, passwordResetMail({ ...input, resetUrl }));
  }

  sendInvitation(to: string, input: { firstName: string; clinicName: string }) {
    return this.send(to, invitationMail({ ...input, loginUrl: `${this.webUrl}/login` }));
  }

  async send(to: string, content: MailContent): Promise<boolean> {
    if (!this.isConfigured) {
      if (this.isProduction) {
        // Never log the body here: it carries links that grant access to the account.
        this.logger.error(`E-mail "${content.subject}" not sent: mail provider is not configured`);
      } else {
        // Outside production the message is printed so the flow can be followed locally.
        this.logger.warn(`Mail provider not configured. Message for ${to}:\n${content.text}`);
      }
      return false;
    }

    const apiKey = this.config.get<string>('EMAIL_API_KEY');
    try {
      const response = await fetch(this.config.get<string>('EMAIL_API_URL')!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          from: this.config.get<string>('EMAIL_FROM'),
          to,
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.error(
          `E-mail "${content.subject}" rejected by the provider with status ${response.status}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `E-mail "${content.subject}" could not be sent: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }
}
