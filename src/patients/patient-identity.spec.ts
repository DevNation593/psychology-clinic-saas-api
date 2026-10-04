import { ageInYears, assertGuardianForMinor, mergePatientIdentification } from './patient-identity';

describe('mergePatientIdentification', () => {
  it('normalizes the type and the number', () => {
    expect(
      mergePatientIdentification(null, {
        identificationType: 'cedula',
        identificationNumber: ' 171234567-8 ',
      }),
    ).toEqual({ identificationType: 'CEDULA', identificationNumber: '1712345678' });
    expect(
      mergePatientIdentification(null, {
        identificationType: 'OTHER',
        identificationNumber: 'dni 44-556',
      }),
    ).toEqual({ identificationType: 'OTHER', identificationNumber: 'DNI44556' });
  });

  it('keeps stored values the request does not mention and clears the ones sent empty', () => {
    const current = { identificationType: 'PASSPORT', identificationNumber: 'AB12345' };

    expect(mergePatientIdentification(current, {})).toEqual(current);
    expect(mergePatientIdentification(current, { identificationNumber: 'ZX98765' })).toEqual({
      identificationType: 'PASSPORT',
      identificationNumber: 'ZX98765',
    });
    expect(
      mergePatientIdentification(current, { identificationType: null, identificationNumber: '' }),
    ).toEqual({ identificationType: null, identificationNumber: null });
  });

  it.each([
    [{ identificationType: 'CEDULA' }, 'a type without a number'],
    [{ identificationNumber: '1712345678' }, 'a number without a type'],
    [{ identificationType: 'DNI', identificationNumber: '1712345678' }, 'an unknown type'],
    [{ identificationType: 'CEDULA', identificationNumber: '12345' }, 'a short cédula'],
    [{ identificationType: 'RUC', identificationNumber: '1712345678' }, 'a RUC of ten digits'],
    [{ identificationType: 'OTHER', identificationNumber: 'a' }, 'a document of one character'],
  ] as [Record<string, string>, string][])('rejects %j (%s)', (changes) => {
    expect(() => mergePatientIdentification(null, changes)).toThrow(
      expect.objectContaining({
        status: 400,
        response: expect.objectContaining({ code: 'PATIENT_IDENTIFICATION_INVALID' }),
      }),
    );
  });
});

describe('guardian of a minor', () => {
  const today = new Date('2026-10-03T12:00:00Z');

  it('counts whole years up to the birthday', () => {
    expect(ageInYears(new Date('2008-10-03T00:00:00Z'), today)).toBe(18);
    expect(ageInYears(new Date('2008-10-04T00:00:00Z'), today)).toBe(17);
    expect(ageInYears(new Date('2026-01-15T00:00:00Z'), today)).toBe(0);
  });

  it('requires a guardian for a patient under 18', () => {
    expect(() => assertGuardianForMinor(new Date('2015-05-01T00:00:00Z'), null, today)).toThrow(
      expect.objectContaining({
        status: 422,
        response: expect.objectContaining({ code: 'PATIENT_GUARDIAN_REQUIRED' }),
      }),
    );
    expect(() => assertGuardianForMinor(new Date('2015-05-01T00:00:00Z'), '   ', today)).toThrow();
  });

  it('asks nothing of adults, minors with a guardian or patients without a birth date', () => {
    expect(() =>
      assertGuardianForMinor(new Date('2008-10-03T00:00:00Z'), null, today),
    ).not.toThrow();
    expect(() =>
      assertGuardianForMinor(new Date('2015-05-01T00:00:00Z'), 'María Pérez', today),
    ).not.toThrow();
    expect(() => assertGuardianForMinor(null, null, today)).not.toThrow();
  });
});
