import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ClinicalCipher, parseClinicalKeys } from './clinical-cipher';
import { ClinicalCryptoService } from './clinical-crypto.service';

describe('ClinicalCipher', () => {
  const key = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;
  const oldKey = key('2025');
  const newKey = key('2026');
  const cipher = new ClinicalCipher(parseClinicalKeys(oldKey));
  const text = 'Paciente refiere ansiedad — F41.1';

  it('stores neither the text nor a repeatable ciphertext, and reads it back', () => {
    const first = cipher.encrypt('tenant-1', text);
    const second = cipher.encrypt('tenant-1', text);

    expect(first).toMatch(/^enc:v1:2025:/);
    expect(first).not.toContain('ansiedad');
    expect(first).not.toBe(second);
    expect(cipher.decrypt('tenant-1', first)).toBe(text);
    expect(cipher.decrypt('tenant-1', second)).toBe(text);
  });

  it('does not decrypt a value moved to another tenant or tampered with', () => {
    const stored = cipher.encrypt('tenant-1', text);

    expect(() => cipher.decrypt('tenant-2', stored)).toThrow();
    expect(() => cipher.decrypt('tenant-1', stored.slice(0, -2) + 'AA')).toThrow();
  });

  it('returns rows written before encryption as they are', () => {
    expect(cipher.decrypt('tenant-1', text)).toBe(text);
    expect(cipher.decryptJson('tenant-1', { bmi: 24 })).toEqual({ bmi: 24 });
    expect(cipher.decryptJson('tenant-1', null)).toBeNull();
  });

  it('keeps JSON columns as JSON while hiding their content', () => {
    const stored = cipher.encryptJson('tenant-1', { findings: 'caries', surfaces: ['O'] });

    expect(Object.keys(stored as object)).toEqual(['$enc']);
    expect(JSON.stringify(stored)).not.toContain('caries');
    expect(cipher.decryptJson('tenant-1', stored)).toEqual({
      findings: 'caries',
      surfaces: ['O'],
    });
  });

  it('encrypts only the listed string fields that are present', () => {
    const row = { content: text, diagnosis: null, sessionDuration: 50, patientId: 'patient-1' };
    const stored = cipher.encryptFields('tenant-1', row, ['content', 'diagnosis']);

    expect(stored).toMatchObject({ diagnosis: null, sessionDuration: 50, patientId: 'patient-1' });
    expect(stored.content).toMatch(/^enc:v1:/);
    expect(cipher.decryptFields('tenant-1', stored, ['content', 'diagnosis'])).toEqual(row);
  });

  describe('key rotation', () => {
    const rotated = new ClinicalCipher(parseClinicalKeys(`${newKey},${oldKey}`));

    it('writes with the first key and still reads values of the retired one', () => {
      const old = cipher.encrypt('tenant-1', text);

      expect(rotated.decrypt('tenant-1', old)).toBe(text);
      expect(rotated.encrypt('tenant-1', text)).toMatch(/^enc:v1:2026:/);
    });

    it('flags plaintext and values of a retired key for re-encryption', () => {
      expect(rotated.needsReencryption(text)).toBe(true);
      expect(rotated.needsReencryption({ bmi: 24 })).toBe(true);
      expect(rotated.needsReencryption(cipher.encrypt('tenant-1', text))).toBe(true);
      expect(rotated.needsReencryption(cipher.encryptJson('tenant-1', { bmi: 24 }))).toBe(true);
      expect(rotated.needsReencryption(rotated.encrypt('tenant-1', text))).toBe(false);
      expect(rotated.needsReencryption(rotated.encryptJson('tenant-1', { bmi: 24 }))).toBe(false);
      expect(rotated.needsReencryption(null)).toBe(false);
    });

    it('cannot read a value once its key is removed', () => {
      const withoutOld = new ClinicalCipher(parseClinicalKeys(newKey));
      expect(() => withoutOld.decrypt('tenant-1', cipher.encrypt('tenant-1', text))).toThrow(
        /unknown key "2025"/,
      );
    });
  });

  describe('configuration', () => {
    const config = (values: Record<string, string>) =>
      ({ get: (name: string) => values[name] }) as unknown as ConfigService;

    it.each(['short:AAAA', 'no-separator', `:${randomBytes(32).toString('base64')}`])(
      'rejects the malformed entry %s',
      (entry) => {
        expect(() => parseClinicalKeys(entry)).toThrow(/CLINICAL_ENCRYPTION_KEYS/);
      },
    );

    it('rejects a repeated key id', () => {
      expect(() => parseClinicalKeys(`${key('a')},${key('a')}`)).toThrow(/repeated/);
    });

    it('refuses to start in production without a key', () => {
      expect(() => new ClinicalCryptoService(config({ NODE_ENV: 'production' }))).toThrow(
        /required in production/,
      );
    });

    it('passes values through outside production when no key is configured', () => {
      const service = new ClinicalCryptoService(config({ NODE_ENV: 'test' }));

      expect(service.enabled).toBe(false);
      expect(service.encrypt('tenant-1', text)).toBe(text);
      expect(service.encryptJson('tenant-1', { bmi: 24 })).toEqual({ bmi: 24 });
    });

    it('encrypts with the configured key', () => {
      const service = new ClinicalCryptoService(
        config({ NODE_ENV: 'production', CLINICAL_ENCRYPTION_KEYS: oldKey }),
      );
      expect(service.activeKeyId).toBe('2025');
      expect(cipher.decrypt('tenant-1', service.encrypt('tenant-1', text))).toBe(text);
    });
  });
});
