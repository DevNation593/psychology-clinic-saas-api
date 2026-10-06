import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { describeDuration, invitationMail, passwordResetMail } from './mail.templates';

describe('mail templates', () => {
  it('puts the reset link, its validity and the single-use notice in both bodies', () => {
    const mail = passwordResetMail({
      firstName: 'Ana',
      resetUrl: 'https://app.example.com/reset-password?token=abc.def',
      expiresIn: '1h',
    });

    expect(mail.subject).toBe('Restablece tu contraseña de HCX Care');
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('https://app.example.com/reset-password?token=abc.def');
      expect(body).toContain('vence en 1 hora');
      expect(body).toContain('solo se puede usar una vez');
      expect(body).toContain('Hola Ana,');
    }
  });

  it('escapes names so they cannot inject markup', () => {
    const mail = invitationMail({
      firstName: '<script>alert(1)</script>',
      clinicName: 'Centro "A&B"',
      loginUrl: 'https://app.example.com/login',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Centro &quot;A&amp;B&quot;');
    expect(mail.text).toContain('Centro "A&B"');
  });

  it.each([
    ['1h', '1 hora'],
    ['2h', '2 horas'],
    ['30m', '30 minutos'],
    ['1d', '1 día'],
    ['soon', 'un tiempo limitado'],
  ])('describes %s as "%s"', (input, expected) => {
    expect(describeDuration(input)).toBe(expected);
  });
});

describe('MailService', () => {
  const configured = {
    EMAIL_API_URL: 'https://mail.example.test/send',
    EMAIL_API_KEY: 'key-123',
    EMAIL_FROM: 'HCX Care <no-reply@example.test>',
    FRONTEND_URL: 'https://app.example.test/',
  };
  const serviceWith = (values: Record<string, string>) =>
    new MailService({ get: (name: string) => values[name] } as unknown as ConfigService);
  let fetchSpy: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('delivers a password reset with a link to the web app', async () => {
    const sent = await serviceWith(configured).sendPasswordReset('ana@example.com', {
      firstName: 'Ana',
      token: 'abc.def+ghi',
      expiresIn: '1h',
    });

    expect(sent).toBe(true);
    const [url, request] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://mail.example.test/send');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer key-123' });
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      from: 'HCX Care <no-reply@example.test>',
      to: 'ana@example.com',
      subject: 'Restablece tu contraseña de HCX Care',
    });
    expect(body.text).toContain('https://app.example.test/reset-password?token=abc.def%2Bghi');
    expect(body.html).toContain('https://app.example.test/reset-password?token=abc.def%2Bghi');
  });

  it('delivers an invitation that points to the login page', async () => {
    await serviceWith(configured).sendInvitation('luis@example.com', {
      firstName: 'Luis',
      clinicName: 'Centro Integral',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.subject).toBe('Te invitaron a Centro Integral en HCX Care');
    expect(body.text).toContain('https://app.example.test/login');
  });

  it.each([
    [
      'a rejected request',
      () => fetchSpy.mockResolvedValue({ ok: false, status: 422 } as Response),
    ],
    ['a network failure', () => fetchSpy.mockRejectedValue(new Error('timeout'))],
  ])('reports %s without throwing or logging the link', async (_label, arrange) => {
    arrange();

    await expect(
      serviceWith(configured).sendPasswordReset('ana@example.com', {
        firstName: 'Ana',
        token: 'secret-token',
        expiresIn: '1h',
      }),
    ).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify([error.mock.calls, warn.mock.calls])).not.toContain('secret-token');
  });

  it('prints the message outside production when no provider is configured', async () => {
    const sent = await serviceWith({ NODE_ENV: 'development' }).sendPasswordReset('ana@x.com', {
      firstName: 'Ana',
      token: 'dev-token',
      expiresIn: '1h',
    });

    expect(sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('http://localhost:4200/reset-password?token=dev-token');
  });

  it('never logs the link in production, and warns at startup that mail is not configured', async () => {
    const service = serviceWith({ NODE_ENV: 'production' });
    expect(error.mock.calls[0][0]).toContain('EMAIL_API_URL and EMAIL_FROM are not set');

    await service.sendPasswordReset('ana@x.com', {
      firstName: 'Ana',
      token: 'prod-token',
      expiresIn: '1h',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('prod-token');
  });
});
