import { Prisma } from '@prisma/client';

const model = (name: string) => Prisma.dmmf.datamodel.models.find((item) => item.name === name)!;
const field = (modelName: string, fieldName: string) =>
  model(modelName).fields.find((item) => item.name === fieldName);

describe('patient invoicing data model', () => {
  it.each(['billingName', 'billingTaxIdType', 'billingTaxId', 'billingEmail', 'billingAddress'])(
    'stores optional %s on the patient',
    (name) => {
      expect(field('Patient', name)).toMatchObject({ type: 'String', isRequired: false });
    },
  );

  it('links an invoice to a patient without requiring one', () => {
    expect(field('Invoice', 'patientId')).toMatchObject({ type: 'String', isRequired: false });
    expect(field('Invoice', 'patient')).toMatchObject({ type: 'Patient', isRequired: false });
    expect(field('Invoice', 'patient')?.relationOnDelete).toBe('SetNull');
    expect(field('Invoice', 'customerAddress')).toMatchObject({
      type: 'String',
      isRequired: false,
    });
  });

  it('keeps every existing invoice customer column required', () => {
    for (const name of ['customerName', 'customerEmail', 'customerTaxIdType', 'customerTaxId']) {
      expect(field('Invoice', name)).toMatchObject({ isRequired: true });
    }
  });
});
