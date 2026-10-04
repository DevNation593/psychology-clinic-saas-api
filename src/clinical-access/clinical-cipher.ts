import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const JSON_ENVELOPE_KEY = '$enc';

export interface ClinicalKey {
  id: string;
  key: Buffer;
}

/**
 * Parses `CLINICAL_ENCRYPTION_KEYS`: comma-separated `id:base64` pairs, each a 32-byte key.
 * The first key encrypts; the others only decrypt, which is what makes rotation possible.
 */
export function parseClinicalKeys(raw: string | undefined): ClinicalKey[] {
  const keys = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      const id = entry.slice(0, separator);
      const key = Buffer.from(entry.slice(separator + 1), 'base64');
      if (separator < 1 || !/^[A-Za-z0-9_-]+$/.test(id) || key.length !== 32) {
        throw new Error(
          'CLINICAL_ENCRYPTION_KEYS must be a comma-separated list of id:base64 entries with 32-byte keys',
        );
      }
      return { id, key };
    });

  if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
    throw new Error('CLINICAL_ENCRYPTION_KEYS contains a repeated key id');
  }
  return keys;
}

/**
 * AES-256-GCM for clinical fields. Every value is bound to its tenant, so a ciphertext copied
 * into another tenant's row does not decrypt. Values written before encryption existed are
 * returned as they are, which lets old rows be read until the backfill script has run.
 */
export class ClinicalCipher {
  constructor(private readonly keys: ClinicalKey[] = []) {}

  get enabled(): boolean {
    return this.keys.length > 0;
  }

  get activeKeyId(): string | null {
    return this.keys[0]?.id ?? null;
  }

  isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(tenantId: string, plaintext: string): string {
    const active = this.keys[0];
    if (!active) return plaintext;

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', active.key, iv);
    cipher.setAAD(Buffer.from(tenantId));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return (
      PREFIX +
      [
        active.id,
        ...[iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')),
      ].join(':')
    );
  }

  decrypt(tenantId: string, value: string): string {
    if (!this.isEncrypted(value)) return value;

    const [keyId, iv, tag, data] = value.slice(PREFIX.length).split(':');
    const key = this.keys.find(({ id }) => id === keyId);
    if (!key || !iv || !tag || data === undefined) {
      throw new Error(`Clinical value cannot be decrypted: unknown key "${keyId}" or bad format`);
    }

    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(tenantId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** JSON columns keep being JSON: the value is replaced by `{ "$enc": "<ciphertext>" }`. */
  encryptJson(tenantId: string, value: unknown): unknown {
    if (!this.enabled || value === null || value === undefined) return value;
    return { [JSON_ENVELOPE_KEY]: this.encrypt(tenantId, JSON.stringify(value)) };
  }

  decryptJson(tenantId: string, value: unknown): unknown {
    if (!this.isJsonEnvelope(value)) return value;
    return JSON.parse(this.decrypt(tenantId, value[JSON_ENVELOPE_KEY]));
  }

  /** Encrypts the listed string fields that are present; null and undefined stay untouched. */
  encryptFields<T extends object>(tenantId: string, row: T, fields: readonly (keyof T)[]): T {
    return this.mapFields(row, fields, (value) => this.encrypt(tenantId, value));
  }

  decryptFields<T extends object>(tenantId: string, row: T, fields: readonly (keyof T)[]): T {
    return this.mapFields(row, fields, (value) => this.decrypt(tenantId, value));
  }

  /** True when the stored value is plaintext or was written with a key that is no longer active. */
  needsReencryption(value: unknown): boolean {
    if (!this.enabled || value === null || value === undefined) return false;
    const stored = this.isJsonEnvelope(value) ? value[JSON_ENVELOPE_KEY] : value;
    return !this.isEncrypted(stored) || !stored.startsWith(`${PREFIX}${this.activeKeyId}:`);
  }

  private isJsonEnvelope(value: unknown): value is Record<typeof JSON_ENVELOPE_KEY, string> {
    return (
      typeof value === 'object' &&
      value !== null &&
      Object.keys(value).length === 1 &&
      this.isEncrypted((value as Record<string, unknown>)[JSON_ENVELOPE_KEY])
    );
  }

  private mapFields<T extends object>(
    row: T,
    fields: readonly (keyof T)[],
    transform: (value: string) => string,
  ): T {
    const result = { ...row };
    for (const field of fields) {
      const value = result[field];
      if (typeof value === 'string') {
        result[field] = transform(value) as T[keyof T];
      }
    }
    return result;
  }
}
