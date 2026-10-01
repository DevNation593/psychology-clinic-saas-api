import {
  isValidTaxId,
  normalizeTaxId,
  PatientBillingSource,
  resolveInvoiceCustomer,
} from './invoice-customer';

const patient = (overrides: Partial<PatientBillingSource> = {}): PatientBillingSource => ({
  firstName: 'Ana',
  lastName: 'Vega',
  email: 'ana@example.com',
  billingName: null,
  billingTaxIdType: null,
  billingTaxId: null,
  billingEmail: null,
  billingAddress: null,
  ...overrides,
});
const stored = patient({
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
});

describe('tax ID rules', () => {
  it.each([
    ['CEDULA', '1712345678', true],
    ['CEDULA', '171234567', false],
    ['CEDULA', '17123456789', false],
    ['RUC', '1790000000001', true],
    ['RUC', '179000000000', false],
    ['PASSPORT', 'AB12345', true],
    ['PASSPORT', 'AB1', false],
    ['PASSPORT', 'AB-12345', false],
    ['DNI', '1712345678', false],
  ])('%s %s → %s', (type, value, expected) => {
    expect(isValidTaxId(type, value)).toBe(expected);
  });

  it('strips separators people type and upper-cases passports', () => {
    expect(normalizeTaxId(' 171 234-5678 ')).toBe('1712345678');
    expect(normalizeTaxId('1790-000000-001')).toBe('1790000000001');
    expect(normalizeTaxId('ab12345')).toBe('AB12345');
  });
});

describe('resolveInvoiceCustomer', () => {
  it('uses the billing data stored on the patient', () => {
    expect(resolveInvoiceCustomer(stored)).toEqual({
      invalid: [],
      customer: {
        name: 'Luis Vega',
        taxIdType: 'CEDULA',
        taxId: '1712345678',
        email: 'luis@example.com',
        address: 'Av. 1',
      },
    });
  });

  it('falls back to the patient for name and e-mail only', () => {
    const result = resolveInvoiceCustomer(
      patient({ billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' }),
    );
    expect(result.customer).toMatchObject({
      name: 'Ana Vega',
      email: 'ana@example.com',
      address: null,
    });
  });

  it('never assumes a tax ID', () => {
    expect(resolveInvoiceCustomer(patient())).toEqual({
      customer: null,
      invalid: ['taxIdType', 'taxId'],
    });
  });

  it('lets the request override individual fields and keeps the rest', () => {
    const result = resolveInvoiceCustomer(stored, {
      name: 'Seguros Andina S.A.',
      taxIdType: 'RUC',
      taxId: '1790-000000-001',
    });
    expect(result.customer).toEqual({
      name: 'Seguros Andina S.A.',
      taxIdType: 'RUC',
      taxId: '1790000000001',
      email: 'luis@example.com',
      address: 'Av. 1',
    });
  });

  it('treats an empty or blank override as not provided', () => {
    const result = resolveInvoiceCustomer(stored, { taxId: '', name: '   ', email: null });
    expect(result.customer).toMatchObject({
      name: 'Luis Vega',
      taxId: '1712345678',
      email: 'luis@example.com',
    });
  });

  it.each([
    [
      'name',
      { name: 'A' },
      patient({
        firstName: '',
        lastName: '',
        billingTaxIdType: 'CEDULA',
        billingTaxId: '1712345678',
      }),
    ],
    ['email', { email: 'not-an-email' }, stored],
    ['taxIdType', { taxIdType: 'DNI' }, stored],
    ['taxId', { taxId: '123' }, stored],
  ])('reports an invalid %s', (fieldName, override, source) => {
    const result = resolveInvoiceCustomer(source, override);
    expect(result.customer).toBeNull();
    expect(result.invalid).toContain(fieldName);
  });

  it('reports a number that does not match an overridden type', () => {
    const result = resolveInvoiceCustomer(stored, { taxIdType: 'RUC' });
    expect(result).toEqual({ customer: null, invalid: ['taxId'] });
  });

  it('reports a missing e-mail when neither the payer nor the patient has one', () => {
    const result = resolveInvoiceCustomer(
      patient({ email: null, billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' }),
    );
    expect(result).toEqual({ customer: null, invalid: ['email'] });
  });
});
