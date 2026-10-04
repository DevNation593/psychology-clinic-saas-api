export const TAX_ID_TYPES = ['CEDULA', 'RUC', 'PASSPORT'] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];
export type CustomerField = 'name' | 'taxIdType' | 'taxId' | 'email';

export interface InvoiceCustomer {
  name: string;
  taxIdType: TaxIdType;
  taxId: string;
  email: string;
  address: string | null;
}

export interface CustomerOverride {
  name?: string | null;
  taxIdType?: string | null;
  taxId?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface PatientBillingSource {
  firstName: string;
  lastName: string;
  email: string | null;
  billingName: string | null;
  billingTaxIdType: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
}

// Format only; check digits are deliberately not verified.
const TAX_ID_PATTERNS: Record<TaxIdType, RegExp> = {
  CEDULA: /^\d{10}$/,
  RUC: /^\d{13}$/,
  PASSPORT: /^[A-Z0-9]{5,20}$/,
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isTaxIdType(value: string): value is TaxIdType {
  return (TAX_ID_TYPES as readonly string[]).includes(value);
}

export function isValidTaxId(type: string, value: string): boolean {
  return isTaxIdType(type) && TAX_ID_PATTERNS[type].test(value);
}

/** First non-blank value, so an empty override never hides a stored one. */
function firstFilled(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function resolveInvoiceCustomer(
  patient: PatientBillingSource,
  override: CustomerOverride = {},
): { customer: InvoiceCustomer; invalid: [] } | { customer: null; invalid: CustomerField[] } {
  const patientName = `${patient.firstName} ${patient.lastName}`.trim();
  const name = firstFilled(override.name, patient.billingName, patientName);
  const email = firstFilled(override.email, patient.billingEmail, patient.email);
  const taxIdType = firstFilled(override.taxIdType, patient.billingTaxIdType);
  const rawTaxId = firstFilled(override.taxId, patient.billingTaxId);
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : null;
  // The address is optional, so an explicitly empty one means "none" rather than "not provided".
  const address =
    override.address === undefined || override.address === null
      ? firstFilled(patient.billingAddress)
      : override.address.trim() || null;

  const invalid: CustomerField[] = [];
  if (!name || name.length < 2) invalid.push('name');
  if (!taxIdType || !isTaxIdType(taxIdType)) invalid.push('taxIdType');
  if (!taxId || (taxIdType && isTaxIdType(taxIdType) && !isValidTaxId(taxIdType, taxId))) {
    invalid.push('taxId');
  }
  if (!email || !EMAIL_PATTERN.test(email)) invalid.push('email');

  if (invalid.length > 0) return { customer: null, invalid };
  return {
    invalid: [],
    customer: {
      name: name!,
      taxIdType: taxIdType as TaxIdType,
      taxId: taxId!,
      email: email!,
      address,
    },
  };
}
