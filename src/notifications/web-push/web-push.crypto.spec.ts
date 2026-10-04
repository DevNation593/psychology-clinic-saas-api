import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'crypto';
import {
  MAX_PAYLOAD_BYTES,
  encryptPushPayload,
  generateVapidKeys,
  vapidAuthorization,
} from './web-push.crypto';

const b64 = (value: string) => Buffer.from(value, 'base64url');
const hkdf = (salt: Buffer, ikm: Buffer, info: string | Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info), length));

/** What a browser does with a received message (RFC 8291 section 3.4), to check ours opens. */
function decryptAsBrowser(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const senderPublic = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const ikm = hkdf(
    auth,
    receiver.computeSecret(senderPublic),
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPublic]),
    32,
  );
  const decipher = createDecipheriv(
    'aes-128-gcm',
    hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16),
    hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12),
  );
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return { text: padded.subarray(0, -1).toString('utf8'), delimiter: padded[padded.length - 1] };
}

describe('Web Push encryption', () => {
  it('reproduces the example message of RFC 8291, section 5', () => {
    const body = encryptPushPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      b64('DGv6ra1nlYgDCS1FRnbzlw'),
      b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    );

    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('produces a message the subscribed browser can open, different every time', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = Buffer.alloc(16, 9);
    const keys = { p256dh: browser.getPublicKey('base64url'), auth: auth.toString('base64url') };
    const payload = JSON.stringify({ title: 'Recordatorio', body: 'Actividad próxima a vencer' });

    const first = encryptPushPayload(Buffer.from(payload), keys);
    const second = encryptPushPayload(Buffer.from(payload), keys);

    expect(first.equals(second)).toBe(false);
    expect(first.toString('latin1')).not.toContain('Recordatorio');
    expect(decryptAsBrowser(first, browser, auth)).toEqual({ text: payload, delimiter: 2 });
    expect(decryptAsBrowser(second, browser, auth).text).toBe(payload);
  });

  it('cannot be opened with another subscription secret', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const body = encryptPushPayload(Buffer.from('x'), {
      p256dh: browser.getPublicKey('base64url'),
      auth: Buffer.alloc(16, 1).toString('base64url'),
    });

    expect(() => decryptAsBrowser(body, browser, Buffer.alloc(16, 2))).toThrow();
  });

  it.each([
    ['a short public key', { p256dh: 'AAAA', auth: Buffer.alloc(16).toString('base64url') }],
    ['a short auth secret', { p256dh: generateVapidKeys().publicKey, auth: 'AAAA' }],
  ])('rejects %s', (_label, keys) => {
    expect(() => encryptPushPayload(Buffer.from('x'), keys)).toThrow(/Invalid push subscription/);
  });

  it('rejects a payload that does not fit in one record', () => {
    const keys = { p256dh: generateVapidKeys().publicKey, auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
    expect(() => encryptPushPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), keys)).toThrow(/exceeds/);
    expect(encryptPushPayload(Buffer.alloc(MAX_PAYLOAD_BYTES), keys)).toHaveLength(
      16 + 4 + 1 + 65 + 4096,
    );
  });
});

describe('VAPID authorization', () => {
  const vapid = { ...generateVapidKeys(), subject: 'mailto:soporte@example.com' };
  const now = new Date('2026-10-16T12:00:00Z');

  it('signs a token for the push service origin that verifies with the public key', () => {
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', vapid, now);

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)!;
    expect(match).not.toBeNull();
    const [, head, claims, signature, key] = match;
    expect(key).toBe(vapid.publicKey);
    expect(JSON.parse(b64(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64(claims).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sub: 'mailto:soporte@example.com',
    });

    const publicKey = b64(vapid.publicKey);
    const verified = verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      {
        key: createPublicKey({
          format: 'jwk',
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: publicKey.subarray(1, 33).toString('base64url'),
            y: publicKey.subarray(33).toString('base64url'),
          },
        }),
        dsaEncoding: 'ieee-p1363',
      },
      b64(signature),
    );
    expect(verified).toBe(true);
  });
});
