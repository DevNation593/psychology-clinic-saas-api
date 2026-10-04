import { BadRequestException } from '@nestjs/common';
import { mergePatientBilling, PatientBillingFields } from './patient-billing';

const empty: PatientBillingFields = {
  billingName: null,
  billingTaxIdType: null,
  billingTaxId: null,
  billingEmail: null,
  billingAddress: null,
};
const saved: PatientBillingFields = {
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
};

describe('mergePatientBilling', () => {
  it('leaves billing data empty when nothing is provided on create', () => {
    expect(mergePatientBilling(null, {})).toEqual(empty);
  });

  it('stores a complete payer, normalizing the number', () => {
    expect(
      mergePatientBilling(null, {
        billingName: ' Seguros Andina ',
        billingTaxIdType: 'RUC',
        billingTaxId: '1790-000000-001',
        billingEmail: 'pagos@andina.test',
      }),
    ).toEqual({
      billingName: 'Seguros Andina',
      billingTaxIdType: 'RUC',
      billingTaxId: '1790000000001',
      billingEmail: 'pagos@andina.test',
      billingAddress: null,
    });
  });

  it('keeps stored values that an update does not mention', () => {
    expect(mergePatientBilling(saved, { billingEmail: 'nuevo@example.com' })).toEqual({
      ...saved,
      billingEmail: 'nuevo@example.com',
    });
  });

  it.each(['', null])('clears a field sent as %p', (value) => {
    expect(mergePatientBilling(saved, { billingAddress: value }).billingAddress).toBeNull();
  });

  it('clears the whole identification when both parts are emptied', () => {
    expect(mergePatientBilling(saved, { billingTaxIdType: '', billingTaxId: '' })).toMatchObject({
      billingTaxIdType: null,
      billingTaxId: null,
    });
  });

  it.each([
    ['a type without a number', { billingTaxIdType: 'CEDULA' }, empty],
    ['a number without a type', { billingTaxId: '1712345678' }, empty],
    ['an unknown type', { billingTaxIdType: 'DNI', billingTaxId: '1712345678' }, empty],
    ['a number in the wrong format', { billingTaxId: '123' }, saved],
    ['a type that no longer matches the stored number', { billingTaxIdType: 'RUC' }, saved],
    ['an invalid e-mail', { billingEmail: 'nope' }, saved],
    ['a one-letter name', { billingName: 'A' }, saved],
  ])('rejects %s', (_label, changes, current) => {
    expect(() => mergePatientBilling(current, changes)).toThrow(BadRequestException);
  });
});
