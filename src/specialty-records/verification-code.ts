import { randomBytes } from 'crypto';

// Crockford base32: no I, L, O or U, so a code read aloud or typed from paper is unambiguous.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

/** A random code of 80 bits, the one printed on a document and encoded in its QR. */
export function newVerificationCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);

  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code = ALPHABET[Number(bits & 31n)] + code;
    bits >>= 5n;
  }
  return code;
}

/** `ABCD-EFGH-JKMN-PQRS`, as it is printed. */
export function formatVerificationCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/**
 * The stored form of a code as a person typed it: without separators, in upper case and with
 * the letters that are easily confused read as the digits they look like. Null when it cannot
 * be a code.
 */
export function normalizeVerificationCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return code.length === CODE_LENGTH && [...code].every((char) => ALPHABET.includes(char))
    ? code
    : null;
}
