import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'crypto';

/**
 * Web Push without a third-party library: message encryption (RFC 8291, `aes128gcm` content
 * encoding of RFC 8188) and the VAPID authorization header (RFC 8292).
 */

const b64url = (data: Buffer) => data.toString('base64url');
const fromB64url = (value: string) => Buffer.from(value, 'base64url');
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

const RECORD_SIZE = 4096;
/** A single record holds the payload, one padding delimiter byte and the 16-byte GCM tag. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17;

export interface PushKeys {
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The subscription's authentication secret, base64url (16 bytes). */
  auth: string;
}

/**
 * Encrypts a payload for one subscription. `salt` and `senderPrivateKey` are random per
 * message; they are parameters only so the RFC's test vector can be reproduced.
 */
export function encryptPushPayload(
  payload: Buffer,
  keys: PushKeys,
  salt: Buffer = randomBytes(16),
  senderPrivateKey?: Buffer,
): Buffer {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const receiverPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || authSecret.length !== 16) {
    throw new Error('Invalid push subscription keys');
  }

  const sender = createECDH('prime256v1');
  if (senderPrivateKey) sender.setPrivateKey(senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(receiverPublic);

  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]),
    32,
  );
  const contentKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  // 0x02 marks the last (and only) record.
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublic.length]),
    senderPublic,
    ciphertext,
  ]);
}

export interface VapidKeys {
  /** base64url, 65 bytes uncompressed. This is also what the browser subscribes with. */
  publicKey: string;
  /** base64url, 32 bytes. */
  privateKey: string;
  /** `mailto:` or `https:` contact of the sender, required by push services. */
  subject: string;
}

export function generateVapidKeys(): Pick<VapidKeys, 'publicKey' | 'privateKey'> {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** `Authorization` header that proves to the push service who is sending. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = new Date()): string {
  const publicKey = fromB64url(vapid.publicKey);
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
    },
  });

  const encode = (value: object) => b64url(Buffer.from(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });

  return `vapid t=${unsigned}.${b64url(signature)}, k=${vapid.publicKey}`;
}
