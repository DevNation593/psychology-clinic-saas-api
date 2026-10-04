import {
  formatVerificationCode,
  newVerificationCode,
  normalizeVerificationCode,
} from './verification-code';

describe('verification code', () => {
  it('is sixteen unambiguous characters, different every time', () => {
    const codes = Array.from({ length: 200 }, newVerificationCode);

    expect(new Set(codes).size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it('is printed in groups of four', () => {
    expect(formatVerificationCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('reads a typed code whatever its case, separators and look-alike letters', () => {
    expect(normalizeVerificationCode(' abcd-efgh jkmn-pqrs ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeVerificationCode('OIL0-0000-0000-0000')).toBe('0110000000000000');
  });

  it.each(['', 'ABCD', 'ABCD-EFGH-JKMN-PQRS-TVWX', 'ABCD-EFGH-JKMN-PQR!', 'UUUU-UUUU-UUUU-UUUU'])(
    'refuses %p',
    (input) => {
      expect(normalizeVerificationCode(input)).toBeNull();
    },
  );

  it('round-trips every code it generates', () => {
    const code = newVerificationCode();
    expect(normalizeVerificationCode(formatVerificationCode(code).toLowerCase())).toBe(code);
  });
});
